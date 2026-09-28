import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisConnection, SHARE_QUEUE } from '../../src/queue/queue.js';
import { APP_URL, REDIS_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let queue: Queue;

beforeAll(async () => {
  ctx = await startTestApp();
  queue = new Queue(SHARE_QUEUE, { connection: redisConnection(REDIS_URL) });
});
afterAll(async () => {
  await queue.close();
  await ctx.app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /shares', () => {
  it('é idempotente por clientShareId e enfileira uma vez só', async () => {
    const { accessToken } = await register(ctx.http);
    const body = { clientShareId: randomUUID(), text: 'https://youtube.com/shorts/RVv7aPxxN_M?is=abc' };

    const first = await ctx.http().post('/shares').set(auth(accessToken)).send(body).expect(201);
    const retry = await ctx.http().post('/shares').set(auth(accessToken)).send(body).expect(200);

    expect(retry.body.id).toBe(first.body.id);
    expect(first.body.status).toBe('queued');
    const job = await queue.getJob(first.body.id);
    expect(job?.data).toEqual({ shareId: first.body.id, userId: expect.any(String) });
  });

  it('valida a entrada com o contrato', async () => {
    const { accessToken } = await register(ctx.http);
    await ctx.http().post('/shares').set(auth(accessToken)).send({ clientShareId: randomUUID() }).expect(400);
    await ctx.http()
      .post('/shares')
      .set(auth(accessToken))
      .send({ clientShareId: randomUUID(), url: 'http://inseguro.com' })
      .expect(400);
    await ctx.http()
      .post('/shares')
      .set(auth(accessToken))
      .send({ clientShareId: 'nao-e-uuid', text: 'x' })
      .expect(400);
  });

  it('pagina por cursor', async () => {
    const { accessToken } = await register(ctx.http);
    for (let i = 0; i < 22; i++) {
      await ctx.http().post('/shares').set(auth(accessToken)).send({ clientShareId: randomUUID(), text: `item ${i}` }).expect(201);
    }
    const page1 = await ctx.http().get('/shares').set(auth(accessToken)).expect(200);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.http()
      .get('/shares')
      .query({ cursor: page1.body.nextCursor })
      .set(auth(accessToken))
      .expect(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
    const ids = new Set([...page1.body.items, ...page2.body.items].map((s: { id: string }) => s.id));
    expect(ids.size).toBe(22);
  });
});

describe('isolamento entre usuários (RLS, SEC-REQ-16)', () => {
  it('usuário A não lê, lista nem apaga share de B pela API', async () => {
    const a = await register(ctx.http);
    const b = await register(ctx.http);
    const shareB = await ctx.http()
      .post('/shares')
      .set(auth(b.accessToken))
      .send({ clientShareId: randomUUID(), text: 'segredo do B' })
      .expect(201);

    await ctx.http().get(`/shares/${shareB.body.id}`).set(auth(a.accessToken)).expect(404);
    await ctx.http().delete(`/shares/${shareB.body.id}`).set(auth(a.accessToken)).expect(404);
    const listA = await ctx.http().get('/shares').set(auth(a.accessToken)).expect(200);
    expect(listA.body.items.map((s: { id: string }) => s.id)).not.toContain(shareB.body.id);
  });

  it('mesmo com SQL direto como fruiqo_app, o banco só entrega linhas do app.user_id', async () => {
    const a = await register(ctx.http);
    const b = await register(ctx.http);
    const shareB = await ctx.http()
      .post('/shares')
      .set(auth(b.accessToken))
      .send({ clientShareId: randomUUID(), text: 'segredo do B' })
      .expect(201);
    const userA = a.refreshToken.split('.')[0]!;
    const userB = b.refreshToken.split('.')[0]!;

    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      // sem contexto: nada
      expect((await client.query('select id from shares')).rowCount).toBe(0);
      expect((await client.query('select id from users')).rowCount).toBe(0);

      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [userA]);
      expect((await client.query('select id from shares where id = $1', [shareB.body.id])).rowCount).toBe(0);
      expect((await client.query('select id from users where id = $1', [userB])).rowCount).toBe(0);
      // tentar gravar em nome de B falha na policy WITH CHECK
      await expect(
        client.query(
          `insert into shares (user_id, client_share_id, status) values ($1, gen_random_uuid(), 'queued')`,
          [userB],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query('rollback');

      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [userB]);
      expect((await client.query('select id from shares where id = $1', [shareB.body.id])).rowCount).toBe(1);
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });

  it('a role da aplicação não consegue desligar o RLS nem ler outras tabelas', async () => {
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await expect(client.query('alter table shares disable row level security')).rejects.toThrow();
      await expect(client.query('select * from drizzle.__drizzle_migrations')).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
