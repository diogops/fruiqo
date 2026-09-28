import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type LoginRequest,
  LoginRequestSchema,
  type RefreshRequest,
  RefreshRequestSchema,
  type RegisterRequest,
  RegisterRequestSchema,
  type Session,
  type TokenPair,
} from '@fruiqo/contracts';
import { ZodPipe } from '../common/zod-pipe.js';
import type { AccessClaims } from './tokens.js';
import { CurrentAuth, Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';

// Limite mais apertado nas rotas públicas de auth (SEC-REQ-21), além do lockout por conta.
const AUTH_THROTTLE = {
  default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), ttl: 60_000 },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body(new ZodPipe(RegisterRequestSchema)) body: RegisterRequest): Promise<TokenPair> {
    return this.auth.register(body);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginRequestSchema)) body: LoginRequest): Promise<TokenPair> {
    return this.auth.login(body);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(RefreshRequestSchema)) body: RefreshRequest): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentAuth() auth: AccessClaims): Promise<void> {
    return this.auth.logout(auth.userId, auth.sessionId);
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
}
