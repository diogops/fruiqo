import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnection, SHARE_QUEUE } from '../../src/queue/queue.js';
import { APP_URL, REDIS_URL } from '../helpers.js';
import { PASSWORD, register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let queue: Queue;
// Leitura como a API faz: fruiqo_app + app.user_id (RLS). O owner não é superusuário.
const app = new pg.Pool({ connectionString: APP_URL });

beforeAll(async () => {
  ctx = await startTestApp();
  queue = new Queue(SHARE_QUEUE, { connection: redisConnection(REDIS_URL) });
});
afterAll(async () => {
  await queue.close();
  await app.end();
  await ctx.app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function userTables(): Promise<string[]> {
  const { rows } = await app.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY 1`,
  );
  return rows.map((r) => r.table_name);
}

/** Conta linhas do usuário em todas as tabelas com user_id, mais a linha em users. */
async function rowsOf(userId: string): Promise<Record<string, number>> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const out: Record<string, number> = {};
    for (const t of await userTables()) {
      const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${t}" WHERE user_id = $1`, [userId]);
      out[t] = Number(rows[0].n);
    }
    const { rows } = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM users WHERE id = $1', [userId]);
    out.users = Number(rows[0].n);
    await c.query('COMMIT');
    return out;
  } finally {
    c.release();
  }
}

const userIdOf = (accessToken: string) =>
  (JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as { sub: string }).sub;

/** Espalha dados do usuário por várias tabelas usando a API real. */
async function populate(accessToken: string): Promise<void> {
  const h = auth(accessToken);
  await ctx.http().post('/library').set(h).send({ title: 'Filme de teste', kind: 'movie', year: 2020 }).expect(201);
  await ctx.http().post('/lists').set(h).send({ name: 'Lista de teste' }).expect(201);
  await ctx.http().patch('/profile/settings').set(h).send({ rememberMood: true }).expect(200);
  await ctx.http().put('/profile/summary').set(h).send({ summary: 'gosto de comédia leve' }).expect(200);
  await ctx.http().post('/shares').set(h).send({ clientShareId: randomUUID(), text: 'Filmes:\n1. Filme A (2019)' }).expect(201);
}

describe('DELETE /account (LGPD; App Store 5.1.1(v))', () => {
  it('apaga o usuário e tudo dele, sem tocar em outro usuário, e tira os jobs da fila', async () => {
    const a = await register(ctx.http);
    const b = await register(ctx.http);
    const aId = userIdOf(a.accessToken);
    const bId = userIdOf(b.accessToken);
    await populate(a.accessToken);
    await populate(b.accessToken);
    const bBefore = await rowsOf(bId);
    expect(Object.values(await rowsOf(aId)).some((n) => n > 0)).toBe(true);

    await ctx
      .http()
      .delete('/account')
      .set(auth(a.accessToken))
      .send({ password: PASSWORD, confirm: 'EXCLUIR' })
      .expect(204);

    const aAfter = await rowsOf(aId);
    expect(Object.entries(aAfter).filter(([, n]) => n > 0)).toEqual([]);
    expect(await rowsOf(bId)).toEqual(bBefore);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized'], 0, 999);
    expect(jobs.filter((j) => j?.data?.userId === aId)).toEqual([]);

    // sessão morta e login impossível
    await ctx.http().get('/library').set(auth(a.accessToken)).expect(401);
    await ctx.http().post('/auth/login').send({ email: a.email, password: PASSWORD, deviceName: 'vitest' }).expect(401);
    // o outro usuário segue funcionando
    await ctx.http().get('/library').set(auth(b.accessToken)).expect(200);
  });

  it('senha errada: 401 e nada é apagado', async () => {
    const a = await register(ctx.http);
    const before = await rowsOf(userIdOf(a.accessToken));
    await ctx
      .http()
      .delete('/account')
      .set(auth(a.accessToken))
      .send({ password: 'senha-errada-qualquer', confirm: 'EXCLUIR' })
      .expect(401);
    expect(await rowsOf(userIdOf(a.accessToken))).toEqual(before);
  });

  it('sem a confirmação digitada: 400', async () => {
    const a = await register(ctx.http);
    await ctx.http().delete('/account').set(auth(a.accessToken)).send({ password: PASSWORD }).expect(400);
    await ctx
      .http()
      .delete('/account')
      .set(auth(a.accessToken))
      .send({ password: PASSWORD, confirm: 'excluir' })
      .expect(400);
  });

  it('exige login', async () => {
    await ctx.http().delete('/account').send({ password: PASSWORD, confirm: 'EXCLUIR' }).expect(401);
  });
});
