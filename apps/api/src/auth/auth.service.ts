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
import type { LoginRequest, RegisterRequest, Session, TokenPair } from '@fruiqo/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import type { Queue } from 'bullmq';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { SHARE_QUEUE_TOKEN, type ShareJob } from '../queue/queue.js';
import { sessions, users } from '../db/schema.js';
import { randomBytes } from 'node:crypto';
import type { GoogleIdentity } from './google.js';
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
export const LOCKOUT_MINUTES = 15;

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    @Inject(SHARE_QUEUE_TOKEN) private readonly queue: Queue<ShareJob>,
  ) {}

  async register(input: RegisterRequest): Promise<TokenPair> {
    if (!this.env.REGISTRATION_ENABLED) throw new ForbiddenException('Registro desabilitado');
    const allowed = this.env.ALLOWED_EMAILS;
    if (allowed.length > 0 && !allowed.includes(input.email)) {
      throw new ForbiddenException('E-mail não autorizado');
    }

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

  async login(input: LoginRequest): Promise<TokenPair> {
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
      return this.createSession(tx, found.id, input.deviceName);
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
  async loginWithGoogle(id: GoogleIdentity, deviceName: string): Promise<{ pair: TokenPair; email: string }> {
    const found = (
      await this.db.execute<{ id: string; google_sub: string | null; by_sub: boolean | null }>(sql`select * from auth_lookup_google(${id.sub}, ${id.email})`)
    ).rows[0];
    if (found) {
      // o e-mail é o mesmo, mas a conta já está ligada a OUTRA conta Google: não troca o vínculo
      if (!found.by_sub && found.google_sub && found.google_sub !== id.sub) throw new UnauthorizedException('Esta conta está ligada a outra conta Google');
      const pair = await withUser(this.db, found.id, async (tx) => {
        const [me] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, found.id));
        await tx
          .update(users)
          .set({ googleSub: id.sub, failedLogins: 0, lockedUntil: null, ...(!me?.displayName && id.name ? { displayName: id.name } : {}) })
          .where(eq(users.id, found.id));
        return this.createSession(tx, found.id, deviceName);
      });
      const [row] = await withUser(this.db, found.id, (tx) => tx.select({ email: users.email }).from(users).where(eq(users.id, found.id)));
      return { pair, email: row?.email ?? id.email };
    }

    if (!this.env.REGISTRATION_ENABLED) throw new ForbiddenException('Registro desabilitado');
    const allowed = this.env.ALLOWED_EMAILS;
    if (allowed.length > 0 && !allowed.includes(id.email)) throw new ForbiddenException('E-mail não autorizado');
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

  private async createSession(tx: Tx, userId: string, deviceName: string): Promise<TokenPair> {
    const sessionId = randomUUID();
    const secret = newRefreshSecret();
    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      deviceName,
      refreshHash: hashSecret(secret),
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
