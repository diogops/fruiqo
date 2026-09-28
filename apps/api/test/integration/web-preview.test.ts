// RF-17 (CORS do Expo web), taxonomia para o editor de gêneros e sinais de gosto do PATCH (RF-34).
import { GENRES, SUBGENRES } from '@fruiqo/taxonomy';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/library/demo-seed.js';
import { APP_URL, OWNER_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

const WEB = 'http://localhost:8082';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let noCors: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);
const owner = new pg.Pool({ connectionString: OWNER_URL });

beforeAll(async () => {
  ctx = await startTestApp({ WEB_ORIGIN: `${WEB},http://127.0.0.1:8082/` });
  noCors = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await noCors.app.close();
  await pool.end();
  await owner.end();
});

describe('CORS (WEB_ORIGIN)', () => {
  it('preflight da origem configurada é aceito, sem credenciais', async () => {
    const res = await ctx
      .http()
      .options('/shares')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-fruiqo-fixture');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Fruiqo-Fixture/i);
  });

  it('origem fora da lista não recebe cabeçalho de CORS', async () => {
    const res = await ctx.http().get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sem WEB_ORIGIN, nenhum CORS', async () => {
    const res = await noCors.http().get('/health').set('Origin', WEB);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /taxonomy/genres', () => {
  it('exige sessão', async () => {
    await ctx.http().get('/taxonomy/genres').expect(401);
  });

  it('lista todos os gêneros e subgêneros com rótulo pt-BR', async () => {
    const user = await register(ctx.http);
    const res = await ctx.http().get('/taxonomy/genres').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(res.body.genres).toHaveLength(GENRES.length);
    expect(res.body.subgenres).toHaveLength(SUBGENRES.length);
    expect(res.body.genres).toContainEqual({ key: 'comedy', label: 'Comédia' });
    expect(res.body.subgenres).toContainEqual({ key: 'romcom', label: 'Comédia romântica' });
  });
});

describe('PATCH /library/:id grava sinais de gosto (RF-34)', () => {
  it('assistido e nota viram taste_signals; repetir o mesmo valor não duplica', async () => {
    const user = await register(ctx.http);
    const userId = user.refreshToken.split('.')[0]!;
    const { idByTitle } = await seedDemo(db, userId);
    const id = idByTitle.get('O Auto da Compadecida')!;
    const patch = (body: object) =>
      ctx.http().patch(`/library/${id}`).set('authorization', `Bearer ${user.accessToken}`).send(body).expect(200);

    const signals = async () =>
      (
        await owner.query<{ signal: string; value: number }>(
          'SELECT signal, value FROM taste_signals WHERE user_id = $1 AND recommendation_id = $2 ORDER BY created_at, signal',
          [userId, id],
        )
      ).rows;

    const before = await signals();
    await patch({ status: 'watched' });
    await patch({ rating: 4 });
    await patch({ status: 'watched', rating: 4 });
    const added = (await signals()).slice(before.length);
    expect(added).toEqual([
      { signal: 'watched', value: 1 },
      { signal: 'rated', value: 4 },
    ]);
  });
});
