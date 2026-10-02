// Área de administração: quem pode usar o Fruiqo. Só para os e-mails de ADMIN_EMAILS, com MFA ligado e
// numa sessão que passou pelo MFA (senha/Google sozinhos não bastam).
import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Put } from '@nestjs/common';
import { type AccessDecisionRequest, AccessDecisionRequestSchema, type AccessListResponse } from '@fruiqo/contracts';
import { eq } from 'drizzle-orm';
import { ZodPipe } from '../common/zod-pipe.js';
import { DB, type Db, withUser } from '../db/client.js';
import { users } from '../db/schema.js';
import { CurrentAuth } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AccessClaims } from './tokens.js';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Administrador, com MFA ligado e sessão verificada; devolve o e-mail dele. */
  private async requireAdmin(a: AccessClaims): Promise<string> {
    const [me] = await withUser(this.db, a.userId, (tx) => tx.select({ email: users.email, mfa: users.mfaEnabled }).from(users).where(eq(users.id, a.userId)));
    if (!me || !this.auth.isAdminEmail(me.email)) throw new ForbiddenException('Só o administrador acessa esta área');
    if (!me.mfa) throw new ForbiddenException({ message: 'Ative a verificação em duas etapas para usar a administração', code: 'mfa_setup_required' });
    if (!(await this.auth.sessionMfaVerified(a.userId, a.sessionId))) {
      throw new ForbiddenException({ message: 'Entre de novo com o código do app autenticador', code: 'mfa_required' });
    }
    return me.email;
  }

  @Get('access')
  async list(@CurrentAuth() a: AccessClaims): Promise<AccessListResponse> {
    await this.requireAdmin(a);
    return this.auth.listAccess();
  }

  /** Aprova ou recusa/revoga um e-mail (também serve para autorizar um e-mail que ainda não pediu). */
  @Put('access')
  @HttpCode(204)
  async decide(@CurrentAuth() a: AccessClaims, @Body(new ZodPipe(AccessDecisionRequestSchema)) body: AccessDecisionRequest): Promise<void> {
    const admin = await this.requireAdmin(a);
    if (this.auth.isAdminEmail(body.email) && body.status === 'denied') throw new ForbiddenException('O administrador não pode revogar a si mesmo');
    await this.auth.decideAccess(admin, body);
  }
}
