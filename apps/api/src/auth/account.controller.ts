import { Body, Controller, Delete, HttpCode, Inject, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type DeleteAccountRequest, DeleteAccountRequestSchema } from '@fruiqo/contracts';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/zod-pipe.js';
import { ENV, type Env } from '../config/env.js';
import { CurrentAuth } from './auth.guard.js';
import { AuthService } from './auth.service.js';
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
    await this.auth.deleteAccount(auth.userId, body.password);
    if (webOrigin) clearRefreshCookie(res, webOrigin, this.env.WEB_COOKIE_PATH);
  }
}
