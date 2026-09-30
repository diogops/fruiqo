// D-23: sincronização do Catálogo com o TMDB (fetch falso; sem rede). Ordem pedida pelo dono do
// produto: primeiro os mais bem avaliados, depois do mais novo para o mais velho.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendations } from '../../src/db/schema.js';
import { CatalogSync } from '../../src/library/catalog-sync.js';
import { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';
import { APP_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp({ PIPELINE_MODE: 'mock' });
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

const userIdOf = (u: { refreshToken: string }) => u.refreshToken.split('.')[0]!;

/** TMDB falso: "melhores" = ids 1xx, "mais novos" = ids 2xx com datas decrescentes a partir do corte */
function fakeTmdb() {
  const urls: URL[] = [];
  let newestCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    urls.push(url);
    const media = url.pathname.endsWith('/discover/tv') ? 'tv' : 'movie';
    const sort = url.searchParams.get('sort_by') ?? '';
    const page = Number(url.searchParams.get('page'));
    let results: object[] = [];
    if (sort === 'vote_average.desc' && page === 1) {
      results = [0, 1].map((i) => ({
        id: (media === 'tv' ? 150 : 100) + i,
        ...(media === 'tv' ? { name: `Melhor Série ${i}`, first_air_date: '2010-01-01' } : { title: `Melhor Filme ${i}`, release_date: '2000-01-01' }),
        vote_average: 9 - i,
        vote_count: 5000,
      }));
    }
    if (sort.endsWith('date.desc') && page === 1) {
      newestCalls++;
      const until = url.searchParams.get(media === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte')!;
      results = [0, 1].map((i) => {
        const d = new Date(`${until}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 10 * (i + 1));
        const date = d.toISOString().slice(0, 10);
        return {
          id: (media === 'tv' ? 250 : 200) + newestCalls * 10 + i,
          ...(media === 'tv' ? { name: `Nova Série ${date}`, first_air_date: date } : { title: `Novo Filme ${date}`, release_date: date }),
          vote_average: 6,
          vote_count: 12,
        };
      });
    }
    return new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { urls, tmdb: new TmdbResolver('k'.repeat(32), fetchImpl) };
}

const BUDGET = { bestPages: { movie: 3, tv: 3 }, olderPages: { movie: 1, tv: 1 }, headPages: 1, delayMs: 0 };

describe('D-23: sincronização do Catálogo', () => {
  it('melhores primeiro, depois do mais novo ao mais velho; entra como Catálogo, sem fila; continua de onde parou', async () => {
    const u = await register(ctx.http);
    const userId = userIdOf(u);
    const { urls, tmdb } = fakeTmdb();
    const sync = new CatalogSync(db, tmdb, BUDGET, () => '2026-09-30');

    const first = await sync.syncUser(userId);
    expect(first.added).toBeGreaterThanOrEqual(8);
    // ordem das chamadas: todas as de "melhores" antes das de "mais novos"
    const sorts = urls.map((x) => x.searchParams.get('sort_by')!);
    const lastBest = sorts.lastIndexOf('vote_average.desc');
    expect(sorts.findIndex((x) => x.endsWith('date.desc'))).toBeGreaterThan(lastBest);
    // só o que está disponível no Brasil
    expect(urls.every((x) => x.searchParams.get('watch_region') === 'BR')).toBe(true);

    const rows = await withUser(db, userId, (tx) => tx.select().from(recommendations));
    expect(rows.every((r) => r.status === 'catalog' && r.rank === null && r.decision === 'cataloged')).toBe(true);
    expect(rows.find((r) => r.title === 'Melhor Filme 0')!.resolution).toMatchObject({ voteAverage: 9, tmdbId: 100, mediaType: 'movie' });

    const s1 = await sync.status(userId);
    expect(s1).toMatchObject({ status: 'idle', bestDone: true, catalogCount: rows.length, lastAdded: first.added });
    expect(s1.olderThan! < '2026-09-30').toBe(true);

    // 2ª rodada: não repete os melhores; os mais novos continuam antes da data em que parou
    urls.length = 0;
    const second = await sync.syncUser(userId);
    expect(urls.some((x) => x.searchParams.get('sort_by') === 'vote_average.desc')).toBe(false);
    const cuts = urls.map((x) => x.searchParams.get('primary_release_date.lte')).filter(Boolean);
    expect(cuts).toContain('2026-09-30'); // lançamentos recentes, revistos a cada rodada
    expect(cuts).toContain(s1.olderThan); // e segue para trás de onde parou
    expect(second.added).toBeGreaterThan(0);
    expect((await sync.status(userId)).totalAdded).toBe(first.added + second.added);
  });

  it('não duplica o que o usuário já tem e não mexe na Minha Área', async () => {
    const u = await register(ctx.http);
    const userId = userIdOf(u);
    const mine = (await ctx.http().post('/library').set('Authorization', `Bearer ${u.accessToken}`).send({ title: 'Melhor Filme 0', kind: 'movie' }).expect(201)).body;
    const { tmdb } = fakeTmdb();
    await new CatalogSync(db, tmdb, BUDGET, () => '2026-09-30').syncUser(userId);
    const [row] = await withUser(db, userId, (tx) => tx.select().from(recommendations).where(eq(recommendations.id, mine.id)));
    expect(row).toMatchObject({ status: mine.status, rank: mine.rank });
    const all = await withUser(db, userId, (tx) => tx.select().from(recommendations));
    expect(all.filter((r) => r.title === 'Melhor Filme 0')).toHaveLength(1);
  });

  it('HTTP: GET /library/sync mostra o estado; POST põe na fila (202) e não duplica pedido em andamento', async () => {
    const u = await register(ctx.http);
    const auth = ['Authorization', `Bearer ${u.accessToken}`] as const;
    const idle = (await ctx.http().get('/library/sync').set(...auth).expect(200)).body;
    expect(idle).toMatchObject({ status: 'idle', catalogCount: 0, totalAdded: 0, bestDone: false });
    const queued = (await ctx.http().post('/library/sync').set(...auth).expect(202)).body;
    expect(queued.status).toBe('queued');
    expect((await ctx.http().post('/library/sync').set(...auth).expect(202)).body.status).toBe('queued');
  });
});
