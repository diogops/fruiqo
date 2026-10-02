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
  type ForgotPasswordRequest,
  ForgotPasswordRequestSchema,
  type ResetPasswordRequest,
  ResetPasswordRequestSchema,
  type MfaChallenge,
  type MfaVerifyRequest,
  MfaVerifyRequestSchema,
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
  ): Promise<TokenPair | WebSessionResponse | MfaChallenge> {
    const origin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    return this.respond(await this.auth.login(body), res, origin);
  }

  /** Segunda etapa do login (MFA): o código do app autenticador ou um de recuperação. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('mfa')
  @HttpCode(200)
  async mfa(
    @Body(new ZodPipe(MfaVerifyRequestSchema)) body: MfaVerifyRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<(TokenPair | WebSessionResponse) & { email: string }> {
    const origin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    const { pair, email } = await this.auth.completeMfa(body.mfaToken, body.code);
    return { ...this.respond(pair, res, origin), email };
  }

  /** Provedores de login ligados (o web só mostra o botão do Google com o Client ID). */
  @Public()
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { google: this.env.GOOGLE_CLIENT_ID ? { clientId: this.env.GOOGLE_CLIENT_ID } : null, passwordReset: this.auth.passwordResetAvailable };
  }

  /** "Esqueci minha senha": sempre 204 (não revela se a conta existe). */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body(new ZodPipe(ForgotPasswordRequestSchema)) body: ForgotPasswordRequest): Promise<void> {
    await this.auth.forgotPassword(body.email);
  }

  /** Senha nova pelo link do e-mail; todas as sessões são encerradas. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(ResetPasswordRequestSchema)) body: ResetPasswordRequest): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);
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
  ): Promise<(TokenPair | WebSessionResponse | MfaChallenge) & { email: string }> {
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
  /** Sessão aberta: web recebe o refresh no cookie. Desafio de MFA: vai como está (sem sessão ainda). */
  private respond(pair: TokenPair, res: Response, webOrigin: string | undefined): TokenPair | WebSessionResponse;
  private respond(pair: TokenPair | MfaChallenge, res: Response, webOrigin: string | undefined): TokenPair | WebSessionResponse | MfaChallenge;
  private respond(pair: TokenPair | MfaChallenge, res: Response, webOrigin: string | undefined): TokenPair | WebSessionResponse | MfaChallenge {
    if ('mfaRequired' in pair) return pair;
    if (!webOrigin) return pair;
    setRefreshCookie(res, pair.refreshToken, webOrigin, this.env.WEB_COOKIE_PATH);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }
}
