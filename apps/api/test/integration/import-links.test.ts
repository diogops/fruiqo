// Adicionar título não espera o Wikidata (até ~2 s por título): responde com os dados do TMDB e os
// links diretos nos serviços (D-22) são completados em segundo plano logo depois.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendations } from '../../src/db/schema.js';
import { LibraryService } from '../../src/library/library.service.js';
import { ReviewService } from '../../src/library/review.service.js';
import { SearchService } from '../../src/library/search.service.js';
import type { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';
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

describe('importar sem esperar o Wikidata', () => {
  it('responde antes dos links; os links chegam depois no título', async () => {
    const u = await register(ctx.http);
    const userId = u.refreshToken.split('.')[0]!;
    const byIdOpts: unknown[] = [];
    let release!: () => void;
    const slowLinks = new Promise<void>((r) => (release = r));
    const tmdb = {
      byId: async (mediaType: 'movie' | 'tv', id: number, _hint: unknown, opts: unknown) => {
        byIdOpts.push(opts);
        return {
          provider: 'tmdb',
          externalId: `${mediaType}:${id}`,
          title: 'Banshee de Teste',
          url: `https://www.themoviedb.org/${mediaType}/${id}`,
          tmdbId: id,
          mediaType,
          year: 2013,
          providers: [{ name: 'Max', key: 'max', type: 'flatrate' }],
        };
      },
      // o Wikidata "demora": só responde quando o teste libera
      titleLinksOf: async () => {
        await slowLinks;
        return { max: 'https://play.max.com/show/teste' };
      },
    } as unknown as TmdbResolver;
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), tmdb, null);

    const res = await search.import(userId, { items: [{ tmdbId: 41727, mediaType: 'tv' }] });
    expect(res.created.map((t) => t.title)).toEqual(['Banshee de Teste']);
    expect(byIdOpts).toEqual([{ titleLinks: false }]);
    const linksOf = async () =>
      (await withUser(db, userId, (tx) => tx.select({ r: recommendations.resolution }).from(recommendations).where(eq(recommendations.id, res.created[0]!.id))))[0]!.r?.titleLinks;
    expect(await linksOf()).toBeUndefined();

    release();
    await expect.poll(linksOf, { timeout: 3000 }).toEqual({ max: 'https://play.max.com/show/teste' });
  });
});
