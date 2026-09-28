import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
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
        clearRefreshCookie(res, origin);
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
    if (isWebClient(req)) clearRefreshCookie(res, assertWebOrigin(req, this.env));
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
    setRefreshCookie(res, pair.refreshToken, webOrigin);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }
}
