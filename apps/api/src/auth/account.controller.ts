import { Body, Controller, Delete, HttpCode, Inject, Optional, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type DeleteAccountRequest, DeleteAccountRequestSchema } from '@fruiqo/contracts';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod-pipe.js';
import { ENV, type Env } from '../config/env.js';
import { CurrentAuth } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GOOGLE_VERIFIER, type GoogleVerifier } from './google.js';
import type { AccessClaims } from './tokens.js';
import { assertWebOrigin, clearRefreshCookie, isWebClient } from './web-session.js';

// Reautenticação por senha: mesmo teto das rotas públicas de auth (SEC-REQ-21).
const ACCOUNT_THROTTLE = {
  default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), ttl: 60_000 },
};

@Controller('account')
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(GOOGLE_VERIFIER) private readonly google: GoogleVerifier | null = null,
  ) {}

  /** Exclusão definitiva da conta e de tudo dela (LGPD; App Store 5.1.1(v)). */
  @Delete()
  @HttpCode(204)
  @Throttle(ACCOUNT_THROTTLE)
  async delete(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodPipe(DeleteAccountRequestSchema)) body: DeleteAccountRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const webOrigin = isWebClient(req) ? assertWebOrigin(req, this.env) : undefined;
    if (body.password) await this.auth.deleteAccount(auth.userId, { password: body.password });
    else {
      // conta do Google: uma nova confirmação do Google no lugar da senha
      if (!this.google) throw new UnauthorizedException('Login com Google desligado');
      const id = await this.google.verify(body.googleCredential!).catch(() => {
        throw new UnauthorizedException('Confirmação do Google inválida');
      });
      await this.auth.deleteAccount(auth.userId, { google: id });
    }
    if (webOrigin) clearRefreshCookie(res, webOrigin, this.env.WEB_COOKIE_PATH);
  }
}
