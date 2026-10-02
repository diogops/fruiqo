import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import type { AccessDecisionRequest, AccessListResponse, LoginRequest, MfaChallenge, MfaEnableResponse, MfaSetupResponse, RegisterRequest, Session, TokenPair } from '@fruiqo/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import type { Queue } from 'bullmq';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { SHARE_QUEUE_TOKEN, type ShareJob } from '../queue/queue.js';
import { accessRequests, sessions, users } from '../db/schema.js';
import { randomBytes } from 'node:crypto';
import type { GoogleIdentity } from './google.js';
import { decryptSecret, encryptSecret, hashRecovery, mfaKey, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './mfa.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import {
  formatRefreshToken,
  hashSecret,
  newRefreshSecret,
  parseRefreshToken,
  safeEqualHex,
  TokenService,
} from './tokens.js';

export const MAX_FAILED_LOGINS = 5;

interface MfaRow {
  secret: string | null;
  last: number | null;
  recovery: string[] | null;
}
export const LOCKOUT_MINUTES = 15;

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly mfaKeyBuf: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    @Inject(SHARE_QUEUE_TOKEN) private readonly queue: Queue<ShareJob>,
  ) {
    this.mfaKeyBuf = mfaKey(env);
  }

  // ---------- acesso controlado pelo administrador ----------

  /** Há controle de acesso (lista na configuração ou administrador definido)? Sem nenhum, o cadastro é aberto. */
  private get accessControlled(): boolean {
    return this.env.ALLOWED_EMAILS.length > 0 || this.env.ADMIN_EMAILS.length > 0;
  }

  isAdminEmail(email: string): boolean {
    return this.env.ADMIN_EMAILS.includes(email.trim().toLowerCase());
  }

  /** O e-mail pode usar o Fruiqo (configuração, administrador ou aprovado na tela de administração)? */
  async hasAccess(email: string): Promise<boolean> {
    const e = email.trim().toLowerCase();
    if (!this.accessControlled || this.env.ALLOWED_EMAILS.includes(e) || this.isAdminEmail(e)) return true;
    const [row] = await this.db.select({ status: accessRequests.status }).from(accessRequests).where(eq(accessRequests.email, e));
    return row?.status === 'approved';
  }

  /** Sem acesso: registra o pedido (uma vez) para o administrador decidir e recusa com `access_pending`. */
  async assertAccess(email: string): Promise<void> {
    if (await this.hasAccess(email)) return;
    const e = email.trim().toLowerCase();
    const [row] = await this.db.select({ status: accessRequests.status }).from(accessRequests).where(eq(accessRequests.email, e));
    if (!row) await this.db.insert(accessRequests).values({ email: e }).onConflictDoNothing();
    throw new ForbiddenException({
      message: row?.status === 'denied' ? 'O acesso deste e-mail não foi liberado pelo administrador.' : 'Pedido de acesso enviado. Você poderá entrar quando o administrador aprovar.',
      code: 'access_pending',
    });
  }

  /** Área de administração: pedidos e autorizados. */
  async listAccess(): Promise<AccessListResponse> {
    const rows = await this.db.select().from(accessRequests).orderBy(desc(accessRequests.requestedAt));
    const entries = await Promise.all(
      rows.map(async (r) => {
        const found = await this.db.execute<{ id: string }>(sql`select id from auth_lookup_user(${r.email})`);
        return {
          email: r.email,
          status: r.status as AccessListResponse['entries'][number]['status'],
          requestedAt: r.requestedAt.toISOString(),
          decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
          hasAccount: found.rows.length > 0,
        };
      }),
    );
    return { entries, configured: [...new Set([...this.env.ADMIN_EMAILS, ...this.env.ALLOWED_EMAILS])] };
  }

  async decideAccess(adminEmail: string, d: AccessDecisionRequest): Promise<void> {
    const now = new Date();
    await this.db
      .insert(accessRequests)
      .values({ email: d.email, status: d.status, decidedAt: now, decidedBy: adminEmail })
      .onConflictDoUpdate({ target: accessRequests.email, set: { status: d.status, decidedAt: now, decidedBy: adminEmail } });
    this.logger.log({ status: d.status }, 'acesso decidido pelo administrador');
  }

  // ---------- MFA (TOTP) ----------

  /** Começa a ativação: gera o segredo (guardado criptografado, ainda desligado) e o link do app autenticador. */
  async setupMfa(userId: string): Promise<MfaSetupResponse> {
    return withUser(this.db, userId, async (tx) => {
      const [me] = await tx.select({ email: users.email, enabled: users.mfaEnabled }).from(users).where(eq(users.id, userId));
      if (!me) throw new UnauthorizedException('Sessão inválida');
      if (me.enabled) throw new ConflictException('A verificação em duas etapas já está ligada');
      const secret = newTotpSecret();
      await tx.update(users).set({ mfaSecret: encryptSecret(this.mfaKeyBuf, secret), mfaLastStep: null }).where(eq(users.id, userId));
      return { secret, otpauthUrl: otpauthUrl(secret, me.email) };
    });
  }

  /** Confirma com o primeiro código: liga o MFA, devolve os códigos de recuperação e marca esta sessão como verificada. */
  async enableMfa(userId: string, sessionId: string, code: string): Promise<MfaEnableResponse> {
    return withUser(this.db, userId, async (tx) => {
      const [me] = await tx.select({ secret: users.mfaSecret, enabled: users.mfaEnabled }).from(users).where(eq(users.id, userId)).for('update');
      if (!me?.secret || me.enabled) throw new ConflictException('Comece a ativação de novo');
      const step = verifyTotp(decryptSecret(this.mfaKeyBuf, me.secret), code, null);
      if (step === null) throw new UnauthorizedException('Código inválido');
      const recoveryCodes = newRecoveryCodes();
      await tx.update(users).set({ mfaEnabled: true, mfaLastStep: step, mfaRecovery: recoveryCodes.map(hashRecovery) }).where(eq(users.id, userId));
      await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
      this.logger.log({ userId }, 'MFA ligado');
      return { recoveryCodes };
    });
  }

  /** Desliga o MFA (exige um código do app ou de recuperação). */
  async disableMfa(userId: string, code: string): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const [me] = await tx
        .select({ secret: users.mfaSecret, enabled: users.mfaEnabled, last: users.mfaLastStep, recovery: users.mfaRecovery })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!me?.enabled || !me.secret || !this.checkMfaCode(me as MfaRow, code)) throw new UnauthorizedException('Código inválido');
      await tx.update(users).set({ mfaEnabled: false, mfaSecret: null, mfaLastStep: null, mfaRecovery: null }).where(eq(users.id, userId));
      await tx.update(sessions).set({ mfaVerified: false }).where(eq(sessions.userId, userId));
    });
    this.logger.log({ userId }, 'MFA desligado');
  }

  /** Segunda etapa do login: confere o código (ou um de recuperação) e só então abre a sessão. */
  async completeMfa(mfaToken: string, code: string): Promise<{ pair: TokenPair; email: string }> {
    const pending = await this.tokens.verifyMfaPending(mfaToken).catch(() => {
      throw new UnauthorizedException('O código expirou; entre de novo');
    });
    const out = await withUser(this.db, pending.userId, async (tx) => {
      const [me] = await tx
        .select({ email: users.email, secret: users.mfaSecret, enabled: users.mfaEnabled, last: users.mfaLastStep, recovery: users.mfaRecovery })
        .from(users)
        .where(eq(users.id, pending.userId))
        .for('update');
      if (!me?.enabled || !me.secret) return null;
      const patch = this.checkMfaCode(me as MfaRow, code);
      if (!patch) return null;
      await tx.update(users).set(patch).where(eq(users.id, pending.userId));
      return { pair: await this.createSession(tx, pending.userId, pending.deviceName, true), email: me.email };
    });
    if (!out) throw new UnauthorizedException('Código inválido');
    return out;
  }

  /** A sessão passou pelo MFA? (área de administração) */
  async sessionMfaVerified(userId: string, sessionId: string): Promise<boolean> {
    const rows = await withUser(this.db, userId, (tx) => tx.select({ ok: sessions.mfaVerified }).from(sessions).where(eq(sessions.id, sessionId)));
    return rows[0]?.ok === true;
  }

  /** Código do app (passo novo) ou de recuperação (gasta). Devolve o que gravar, ou null. */
  private checkMfaCode(me: MfaRow, code: string): { mfaLastStep: number } | { mfaRecovery: string[] } | null {
    const step = verifyTotp(decryptSecret(this.mfaKeyBuf, me.secret!), code, me.last);
    if (step !== null) return { mfaLastStep: step };
    const h = hashRecovery(code);
    const list = me.recovery ?? [];
    return list.includes(h) ? { mfaRecovery: list.filter((x) => x !== h) } : null;
  }

  /** Senha/Google certos: com MFA ligado, devolve o desafio em vez da sessão. */
  private async sessionOrChallenge(tx: Tx, userId: string, deviceName: string): Promise<TokenPair | MfaChallenge> {
    const [me] = await tx.select({ mfa: users.mfaEnabled }).from(users).where(eq(users.id, userId));
    if (me?.mfa) return { mfaRequired: true, mfaToken: await this.tokens.signMfaPending(userId, deviceName) };
    return this.createSession(tx, userId, deviceName);
  }

  async register(input: RegisterRequest): Promise<TokenPair> {
    if (!this.env.REGISTRATION_ENABLED) throw new ForbiddenException('Registro desabilitado');
    // e-mail sem acesso: vira pedido para o administrador aprovar
    await this.assertAccess(input.email);

    const userId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    try {
      return await withUser(this.db, userId, async (tx) => {
        await tx.insert(users).values({ id: userId, email: input.email, passwordHash });
        return this.createSession(tx, userId, input.deviceName);
      });
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
        throw new ConflictException('Não foi possível criar a conta');
      }
      throw err;
    }
  }

  async login(input: LoginRequest): Promise<TokenPair | MfaChallenge> {
    const result = await this.db.execute<{
      id: string;
      password_hash: string;
      failed_logins: number;
      locked_until: Date | null;
    }>(sql`select * from auth_lookup_user(${input.email})`);
    const found = result.rows[0];

    if (!found) {
      // gasta o mesmo tempo de uma verificação real
      await verifyPassword(await getDummyHash(), input.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (found.locked_until && new Date(found.locked_until) > new Date()) {
      throw new UnauthorizedException('Conta temporariamente bloqueada. Tente mais tarde.');
    }

    const ok = await verifyPassword(found.password_hash, input.password);
    // senha certa, mas o acesso foi revogado (ou ainda não aprovado): não abre sessão
    if (ok) await this.assertAccess(input.email);

    return withUser(this.db, found.id, async (tx) => {
      if (!ok) {
        const failed = found.failed_logins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await tx
          .update(users)
          .set({
            failedLogins: lock ? 0 : failed,
            lockedUntil: lock ? sql`now() + make_interval(mins => ${LOCKOUT_MINUTES})` : null,
          })
          .where(eq(users.id, found.id));
        if (lock) this.logger.warn({ userId: found.id }, 'conta bloqueada por falhas de login');
        // o throw dentro da transação faria rollback do contador; lançamos fora
        return null;
      }
      await tx.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, found.id));
      return this.sessionOrChallenge(tx, found.id, input.deviceName);
    }).then((pair) => {
      if (!pair) throw new UnauthorizedException(INVALID_CREDENTIALS);
      return pair;
    });
  }

  /**
   * Login com Google: acha a conta pelo `sub` (vínculo já feito) ou, na primeira vez, pelo e-mail
   * verificado (e vincula). Sem conta: cria, com as mesmas regras do cadastro (registro aberto e
   * e-mails permitidos), sem senha. O nome do Google vira o nome de exibição só se não houver um.
   */
  async loginWithGoogle(id: GoogleIdentity, deviceName: string): Promise<{ pair: TokenPair | MfaChallenge; email: string }> {
    const found = (
      await this.db.execute<{ id: string; google_sub: string | null; by_sub: boolean | null }>(sql`select * from auth_lookup_google(${id.sub}, ${id.email})`)
    ).rows[0];
    if (found) {
      // o e-mail é o mesmo, mas a conta já está ligada a OUTRA conta Google: não troca o vínculo
      if (!found.by_sub && found.google_sub && found.google_sub !== id.sub) throw new UnauthorizedException('Esta conta está ligada a outra conta Google');
      const [stored] = await withUser(this.db, found.id, (tx) => tx.select({ email: users.email }).from(users).where(eq(users.id, found.id)));
      await this.assertAccess(stored?.email ?? id.email);
      const pair = await withUser(this.db, found.id, async (tx) => {
        const [me] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, found.id));
        await tx
          .update(users)
          .set({ googleSub: id.sub, failedLogins: 0, lockedUntil: null, ...(!me?.displayName && id.name ? { displayName: id.name } : {}) })
          .where(eq(users.id, found.id));
        return this.sessionOrChallenge(tx, found.id, deviceName);
      });
      return { pair, email: stored?.email ?? id.email };
    }

    if (!this.env.REGISTRATION_ENABLED) throw new ForbiddenException('Registro desabilitado');
    await this.assertAccess(id.email);
    const userId = randomUUID();
    // conta sem senha: hash de um segredo aleatório que ninguém conhece (login por senha impossível)
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    try {
      const pair = await withUser(this.db, userId, async (tx) => {
        await tx.insert(users).values({ id: userId, email: id.email, passwordHash, hasPassword: false, googleSub: id.sub, ...(id.name ? { displayName: id.name } : {}) });
        return this.createSession(tx, userId, deviceName);
      });
      return { pair, email: id.email };
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
        throw new ConflictException('Não foi possível criar a conta');
      }
      throw err;
    }
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw new UnauthorizedException('Sessão inválida');
    const presented = hashSecret(parsed.secret);

    const outcome = await withUser(this.db, parsed.userId, async (tx) => {
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, parsed.sessionId))
        .for('update');
      if (!session || session.revokedAt) return { kind: 'invalid' as const };

      if (safeEqualHex(session.refreshHash, presented)) {
        // acesso revogado pelo administrador: a sessão acaba no próximo refresh
        const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, parsed.userId));
        if (!me || !(await this.hasAccess(me.email))) {
          await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
          return { kind: 'invalid' as const };
        }
        const secret = newRefreshSecret();
        await tx
          .update(sessions)
          .set({ refreshHash: hashSecret(secret), prevRefreshHash: session.refreshHash, lastUsedAt: new Date() })
          .where(eq(sessions.id, session.id));
        return {
          kind: 'ok' as const,
          pair: await this.pair(parsed.userId, session.id, secret),
        };
      }

      if (safeEqualHex(session.prevRefreshHash, presented)) {
        // Reuso de refresh já rotacionado: token provavelmente vazou. Revoga a sessão inteira.
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
        return { kind: 'reuse' as const };
      }
      return { kind: 'invalid' as const };
    });

    if (outcome.kind === 'reuse') {
      this.logger.warn({ sessionId: parsed.sessionId }, 'reuso de refresh token; sessão revogada');
    }
    if (outcome.kind !== 'ok') throw new UnauthorizedException('Sessão inválida');
    return outcome.pair;
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.revokeSession(userId, sessionId);
  }

  async listSessions(userId: string, currentSessionId: string): Promise<Session[]> {
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .orderBy(desc(sessions.lastUsedAt)),
    );
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const updated = await withUser(this.db, userId, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id }),
    );
    if (updated.length === 0) throw new NotFoundException('Sessão não encontrada');
  }

  /**
   * Exclusão definitiva da conta (LGPD art. 18, VI; App Store 5.1.1(v)).
   * Reautentica com a senha atual; apagar o usuário remove em cascata todas as tabelas
   * com `user_id` (FK ON DELETE CASCADE; as ações de integridade referencial não passam
   * pelo RLS). A própria linha em `users` sai pela policy `users_self` (app.user_id).
   */
  /** `proof`: a senha atual ou, em conta do Google, a identidade de uma nova confirmação do Google. */
  async deleteAccount(userId: string, proof: { password: string } | { google: GoogleIdentity }): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const [me] = await tx
        .select({ passwordHash: users.passwordHash, hasPassword: users.hasPassword, googleSub: users.googleSub })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!me) throw new UnauthorizedException('Sessão inválida');
      if ('password' in proof) {
        const ok = me.hasPassword && (await verifyPassword(me.passwordHash, proof.password));
        if (!ok) throw new UnauthorizedException('Senha incorreta');
      } else if (!me.googleSub || me.googleSub !== proof.google.sub) {
        throw new UnauthorizedException('Confirme com a mesma conta Google');
      }
      const deleted = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
      if (deleted.length !== 1) throw new UnauthorizedException('Sessão inválida');
    });
    await this.dropQueuedJobs(userId);
    this.logger.log({ userId }, 'conta excluída');
  }

  /** Melhor esforço: jobs pendentes do usuário sairiam como "share não encontrado"; tira da fila. */
  private async dropQueuedJobs(userId: string): Promise<void> {
    try {
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized'], 0, 999);
      await Promise.all(jobs.filter((j) => j?.data?.userId === userId).map((j) => j.remove().catch(() => undefined)));
    } catch (err) {
      this.logger.warn({ err: (err as Error).name }, 'não foi possível limpar a fila após excluir a conta');
    }
  }

  /** Usado pelo guard: a sessão do access token ainda está ativa? */
  async isSessionActive(userId: string, sessionId: string): Promise<boolean> {
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt))),
    );
    return rows.length === 1;
  }

  private async createSession(tx: Tx, userId: string, deviceName: string, mfaVerified = false): Promise<TokenPair> {
    const sessionId = randomUUID();
    const secret = newRefreshSecret();
    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      deviceName,
      refreshHash: hashSecret(secret),
      mfaVerified,
    });
    return this.pair(userId, sessionId, secret);
  }

  private async pair(userId: string, sessionId: string, secret: string): Promise<TokenPair> {
    return {
      accessToken: await this.tokens.signAccess({ userId, sessionId }),
      refreshToken: formatRefreshToken(userId, sessionId, secret),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }
}
