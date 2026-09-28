// Fila de prioridade (rank 1..N por usuário): mover, integridade sob concorrência, triggers de
// inserção/remoção, aprovação da revisão, merge e isolamento RLS.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendations } from '../../src/db/schema.js';
import { seedDemo } from '../../src/library/demo-seed.js';
import { targetPosition } from '../../src/library/rank-queue.js';
import { dedupKey } from '../../src/pipeline/dedup.js';
import { APP_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

const userIdOf = (u: { refreshToken: string }) => u.refreshToken.split('.')[0]!;

async function seeded() {
  const user = await register(ctx.http);
  const userId = userIdOf(user);
  await seedDemo(db, userId);
  const auth = { authorization: `Bearer ${user.accessToken}` };
  const queue = async () =>
    ((await ctx.http().get('/library?sort=rank&limit=200').set(auth).expect(200)).body.items as { id: string; rank: number; title: string }[]);
  const move = (id: string, body: object) => ctx.http().post(`/library/${id}/move`).set(auth).send(body);
  return { user, userId, auth, queue, move };
}

function expectContiguous(ranks: number[]) {
  expect([...ranks].sort((a, b) => a - b)).toEqual(ranks.map((_, i) => i + 1));
}

describe('targetPosition', () => {
  it('limita ao intervalo da fila', () => {
    expect(targetPosition(3, 10, { to: 'top' })).toBe(1);
    expect(targetPosition(3, 10, { to: 'bottom' })).toBe(10);
    expect(targetPosition(1, 10, { to: 'up' })).toBe(1);
    expect(targetPosition(10, 10, { to: 'down' })).toBe(10);
    expect(targetPosition(4, 10, { position: 99 })).toBe(10);
  });
});

describe('POST /library/:id/move', () => {
  it('topo, fundo, cima, baixo e posição, sem buracos nem duplicatas', async () => {
    const { queue, move } = await seeded();
    const start = await queue();
    expectContiguous(start.map((t) => t.rank));
    const n = start.length;
    const x = start[4]!.id;

    let res = await move(x, { to: 'top' }).expect(200);
    expect(res.body).toEqual({ id: x, rank: 1, total: n });
    let q = await queue();
    expect(q[0]!.id).toBe(x);
    // os demais mantêm a ordem relativa
    expect(q.slice(1).map((t) => t.id)).toEqual(start.filter((t) => t.id !== x).map((t) => t.id));

    await move(x, { to: 'down' }).expect(200);
    expect((await queue())[1]!.id).toBe(x);
    await move(x, { to: 'up' }).expect(200);
    expect((await queue())[0]!.id).toBe(x);

    res = await move(x, { to: 'bottom' }).expect(200);
    expect(res.body.rank).toBe(n);
    res = await move(x, { position: 3 }).expect(200);
    q = await queue();
    expect(q[2]!.id).toBe(x);
    expectContiguous(q.map((t) => t.rank));
  });

  it('mantém 1..N contínuo com movimentos concorrentes', async () => {
    const { queue, move } = await seeded();
    const start = await queue();
    const ops = start.slice(0, 12).flatMap((t, i) => [
      move(t.id, { to: i % 2 === 0 ? 'top' : 'bottom' }),
      move(t.id, { position: (i % 5) + 1 }),
    ]);
    const results = await Promise.all(ops);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const q = await queue();
    expect(q).toHaveLength(start.length);
    expectContiguous(q.map((t) => t.rank));
  });

  it('título da fila de revisão não tem posição (409); título de outro usuário → 404', async () => {
    const a = await seeded();
    const b = await seeded();
    const [review] = await withUser(db, a.userId, (tx) =>
      tx
        .insert(recommendations)
        .values({
          userId: a.userId,
          kind: 'movie',
          title: 'Talvez um filme',
          confidence: 0.3,
          extractor: 'heuristic',
          dedupKey: dedupKey({ kind: 'movie', title: 'Talvez um filme' }),
          decision: 'review_queue',
        })
        .returning(),
    );
    expect(review!.rank).toBeNull();
    await a.move(review!.id, { to: 'top' }).expect(409);
    const theirs = (await b.queue())[0]!.id;
    await a.move(theirs, { to: 'top' }).expect(404);
  });
});

describe('triggers da fila', () => {
  it('novo título entra no fim; remoção fecha o buraco; aprovação da revisão entra no fim', async () => {
    const { queue, auth, userId } = await seeded();
    const start = await queue();
    const created = await ctx.http().post('/library').set(auth).send({ title: 'Filme Novo Manual', kind: 'movie' }).expect(201);
    expect(created.body.rank).toBe(start.length + 1);

    await ctx.http().post('/library/bulk').set(auth).send({ titleIds: [start[1]!.id], operation: { type: 'delete' } }).expect(200);
    let q = await queue();
    expect(q).toHaveLength(start.length);
    expectContiguous(q.map((t) => t.rank));

    const [review] = await withUser(db, userId, (tx) =>
      tx
        .insert(recommendations)
        .values({
          userId,
          kind: 'movie',
          title: 'Aprovável',
          confidence: 0.3,
          extractor: 'heuristic',
          dedupKey: dedupKey({ kind: 'movie', title: 'Aprovável' }),
          decision: 'review_queue',
        })
        .returning(),
    );
    const approved = await ctx.http().post(`/review/${review!.id}/approve`).set(auth).expect(200);
    expect(approved.body.rank).toBe(q.length + 1);
    q = await queue();
    expectContiguous(q.map((t) => t.rank));
  });

  it('desfazer uma remoção devolve os títulos à posição que tinham', async () => {
    const { queue, auth } = await seeded();
    const start = await queue();
    const ids = [start[0]!.id, start[3]!.id];
    const del = await ctx.http().post('/library/bulk').set(auth).send({ titleIds: ids, operation: { type: 'delete' } }).expect(200);
    await ctx.http().post('/library/bulk/undo').set(auth).send({ undoToken: del.body.undoToken }).expect(200);
    expect((await queue()).map((t) => t.id)).toEqual(start.map((t) => t.id));
  });

  it('merge fica com a melhor posição dos dois', async () => {
    const { queue, auth } = await seeded();
    const start = await queue();
    const better = start[1]!;
    const worse = start[6]!;
    const res = await ctx.http().post(`/library/${better.id}/merge`).set(auth).send({ intoId: worse.id }).expect(200);
    expect(res.body.rank).toBe(2);
    const q = await queue();
    expect(q).toHaveLength(start.length - 1);
    expectContiguous(q.map((t) => t.rank));
  });

  it('RLS: a fila de um usuário não é visível nem alterável por SQL direto de outro', async () => {
    const a = await seeded();
    const b = await seeded();
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [b.userId]);
      const seen = await client.query('SELECT count(*)::int AS n FROM recommendations WHERE user_id = $1', [a.userId]);
      expect(seen.rows[0].n).toBe(0);
      const upd = await client.query('UPDATE recommendations SET rank = rank + 1000 WHERE user_id = $1', [a.userId]);
      expect(upd.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
    expectContiguous((await a.queue()).map((t) => t.rank));
  });
});
