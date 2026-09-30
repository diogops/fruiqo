import { describe, expect, it } from 'vitest';
import { orderSearchHits } from '../../src/library/search.service.js';
import type { TmdbHit } from '../../src/pipeline/resolvers/tmdb.js';

const hit = (tmdbId: number, voteAverage?: number): TmdbHit => ({
  tmdbId,
  mediaType: 'movie',
  title: `T${tmdbId}`,
  popularity: 1,
  genreIds: [],
  ...(voteAverage != null ? { voteAverage, voteCount: 100 } : {}),
});
const mine = (rank: number | null, rating: number | null = null) => ({ id: '00000000-0000-4000-8000-000000000000', rank, decision: 'cataloged' as const, rating });

describe('D-23: ordem dos resultados da busca', () => {
  const items = [
    { hit: hit(1, 9), mine: null, auto: 3 },
    { hit: hit(2, 6), mine: mine(2), auto: 2 },
    { hit: hit(3, 7), mine: null, auto: 4.5 },
    { hit: hit(4, 8), mine: mine(null, 5), auto: 1 },
    { hit: hit(5, 5), mine: mine(1), auto: 1 },
  ];
  const ids = (sort: Parameters<typeof orderSearchHits>[1]) => orderSearchHits(items, sort).map((x) => x.hit.tmdbId);

  it('padrão: ordem manual → minhas estrelas → automática → geral', () => {
    expect(ids('score')).toEqual([5, 2, 4, 3, 1]);
  });
  it('por nota automática, por nota geral ou por relevância (ordem do TMDB)', () => {
    expect(ids('auto')).toEqual([3, 1, 2, 4, 5]);
    expect(ids('general')).toEqual([1, 4, 3, 2, 5]);
    expect(ids('relevance')).toEqual([1, 2, 3, 4, 5]);
  });
});
