import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthProvidersResponse,
  type GoogleLoginRequest,
  GoogleLoginRequestSchema,
  type LoginRequest,
  LoginRequestSchema,
  RefreshRequestSchema,
  type RegisterRequest,
  RegisterRequestSchema,
  type Session,
  type TokenPair,
  type WebSessionResponse,
} from '@fruiqo/contracts';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod-pipe.js';
import { ENV, type Env } from '../config/env.js';
import { GOOGLE_VERIFIER, type GoogleVerifier } from './google.js';
import type { AccessClaims } from './tokens.js';
import { CurrentAuth, Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import {
  assertWebOrigin,
  clearRefreshCookie,
  isWebClient,
  readRefreshCookie,
  setRefreshCookie,
} from './web-session.js';

// Limite mais apertado nas rotas públicas de auth (SEC-REQ-21), além do lockout por conta.
const AUTH_THROTTLE = {
  default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), ttl: 60_000 },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(GOOGLE_VERIFIER) private readonly googleVerifier: GoogleVerifier | null = null,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body(new ZodPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair | WebSessionResponse> {
    const origin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    return this.respond(await this.auth.register(body), res, origin);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair | WebSessionResponse> {
    const origin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    return this.respond(await this.auth.login(body), res, origin);
  }

  /** Provedores de login ligados (o web só mostra o botão do Google com o Client ID). */
  @Public()
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { google: this.env.GOOGLE_CLIENT_ID ? { clientId: this.env.GOOGLE_CLIENT_ID } : null };
  }

  /** Login com Google: o ID token é conferido aqui e nunca guardado. Web recebe o e-mail junto. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('google')
  @HttpCode(200)
  async google(
    @Body(new ZodPipe(GoogleLoginRequestSchema)) body: GoogleLoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<(TokenPair | WebSessionResponse) & { email: string }> {
    if (!this.googleVerifier) throw new NotFoundException('Login com Google desligado');
    const origin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    const id = await this.googleVerifier.verify(body.credential).catch(() => {
      throw new UnauthorizedException('Login com Google inválido');
    });
    const { pair, email } = await this.auth.loginWithGoogle(id, body.deviceName);
    return { ...this.respond(pair, res, origin), email };
  }

  /** Mobile: refresh no corpo. Web (RF-30): refresh no cookie + cabeçalho X-Fruiqo-Client + origem permitida. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPair | WebSessionResponse> {
    if (isWebClient(req)) {
      const origin = assertWebOrigin(req, this.env);
      const token = readRefreshCookie(req);
      if (!token) throw new UnauthorizedException('Sessão inválida');
      try {
        return this.respond(await this.auth.refresh(token), res, origin);
      } catch (err) {
        clearRefreshCookie(res, origin, this.env.WEB_COOKIE_PATH);
        throw err;
      }
    }
    const parsed = RefreshRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Entrada inválida: refreshToken');
    return this.auth.refresh(parsed.data.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AccessClaims,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth.userId, auth.sessionId);
    if (isWebClient(req)) clearRefreshCookie(res, assertWebOrigin(req, this.env), this.env.WEB_COOKIE_PATH);
  }

  @Get('sessions')
  sessions(@CurrentAuth() auth: AccessClaims): Promise<Session[]> {
    return this.auth.listSessions(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.auth.revokeSession(auth.userId, id);
  }

  /** Web: o refresh vai só no cookie httpOnly; o corpo leva apenas o access token. */
  private respond(pair: TokenPair, res: Response, webOrigin: string | undefined): TokenPair | WebSessionResponse {
    if (!webOrigin) return pair;
    setRefreshCookie(res, pair.refreshToken, webOrigin, this.env.WEB_COOKIE_PATH);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }
}
