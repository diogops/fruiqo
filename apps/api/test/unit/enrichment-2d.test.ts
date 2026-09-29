// Fase 2d: resolver TMDB com detalhes/providers, colunas derivadas, disponibilidade no ranking e
// perfil incremental ≡ rebuild (RF-34, RF-38; TOS-REQ-02/17).
import type { Resolution } from '@fruiqo/contracts';
import type { GenreKey } from '@fruiqo/taxonomy';
import { describe, expect, it } from 'vitest';
import { providerKeyFromTmdbName } from '../../src/library/providers.js';
import {
  accumulateTaste,
  availabilityPhrase,
  pickContinue,
  rankTitles,
  type RankItem,
  type SignalRow,
  tasteFromSignals,
  tasteFromSums,
} from '../../src/library/ranking.js';
import { columnsFromResolution, enrichmentUpdate } from '../../src/library/tmdb-enrichment.js';
import { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k));
    if (!key) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('TmdbResolver.lookup (detalhes + onde assistir)', () => {
  const routes = {
    '/search/multi': {
      results: [
        { id: 1, media_type: 'movie', title: 'Filme X', release_date: '1999-01-01' },
        { id: 2, media_type: 'movie', title: 'Filme X', release_date: '2020-01-01', poster_path: '/p.jpg' },
      ],
    },
    '/movie/2': {
      id: 2,
      title: 'Filme X',
      overview: 'Uma sinopse.',
      runtime: 118,
      genres: [{ id: 35 }, { id: 10749 }],
      external_ids: { imdb_id: 'tt0000002' },
      'watch/providers': {
        results: {
          BR: {
            link: 'https://www.themoviedb.org/movie/2/watch?locale=BR',
            flatrate: [
              { provider_name: 'Netflix', logo_path: '/n.png', display_priority: 1 },
              { provider_name: 'Netflix Standard with Ads', display_priority: 5 },
            ],
            rent: [{ provider_name: 'Apple TV', display_priority: 2 }],
          },
          US: { link: 'https://www.themoviedb.org/movie/2/watch?locale=US', flatrate: [{ provider_name: 'Hulu' }] },
        },
      },
    },
  };

  it('prefere o ano pedido e traz gêneros, sinopse, duração, IMDb e providers BR', async () => {
    const r = new TmdbResolver('k'.repeat(32), fakeFetch(routes));
    const res = (await r.lookup({ title: 'Filme X', kind: 'movie', year: 2020 }))!;
    expect(res.tmdbId).toBe(2);
    expect(res.year).toBe(2020);
    expect(res.overview).toBe('Uma sinopse.');
    expect(res.runtimeMin).toBe(118);
    expect(res.imdbId).toBe('tt0000002');
    expect(res.genreIds).toEqual([35, 10749]);
    expect(res.watchUrl).toBe('https://www.themoviedb.org/movie/2/watch?locale=BR');
    expect(res.providers).toEqual([
      { name: 'Netflix', type: 'flatrate', key: 'netflix', logoUrl: 'https://image.tmdb.org/t/p/w92/n.png' },
      { name: 'Netflix Standard with Ads', type: 'flatrate', key: 'netflix' },
      { name: 'Apple TV', type: 'rent' },
    ]);
    // só o Brasil; nada de outros países
    expect(JSON.stringify(res)).not.toContain('Hulu');
  });

  it('link "onde assistir" só se for do próprio TMDB (sem deep link, TOS-REQ-17)', async () => {
    const bad = structuredClone(routes);
    (bad['/movie/2']['watch/providers'].results.BR as { link: string }).link = 'nflx://title/123';
    const res = (await new TmdbResolver('k'.repeat(32), fakeFetch(bad)).lookup({ title: 'Filme X', kind: 'movie', year: 2020 }))!;
    expect(res.watchUrl).toBeUndefined();
  });

  it('detalhes falhando: a correspondência continua válida', async () => {
    const res = (await new TmdbResolver('k'.repeat(32), fakeFetch({ '/search/multi': routes['/search/multi'] })).lookup({ title: 'Filme X', kind: 'movie' }))!;
    expect(res.tmdbId).toBe(1);
    expect(res.providers).toBeUndefined();
  });
});

describe('colunas derivadas do TMDB', () => {
  const res: Resolution = {
    provider: 'tmdb',
    externalId: 'tv:9',
    title: 'Série',
    url: 'https://www.themoviedb.org/tv/9',
    mediaType: 'tv',
    genreIds: [10765, 18],
    runtimeMin: 45,
    year: 2019,
  };

  it('mapeia IDs do TMDB para a taxonomia (TV: Sci-Fi & Fantasy vira as duas chaves)', () => {
    expect(columnsFromResolution(res)).toEqual({ genres: ['drama', 'fantasy', 'scifi'], runtimeMin: 45, year: 2019, enrichment: 'tmdb' });
  });

  it('não sobrescreve gêneros marcados à mão', () => {
    const upd = enrichmentUpdate({ genres: ['comedy'], enrichment: 'manual', runtimeMin: null, year: null }, res);
    expect(upd).toEqual({ genres: ['comedy'], enrichment: 'manual', runtimeMin: 45, year: 2019 });
    const auto = enrichmentUpdate({ genres: ['comedy'], enrichment: 'demo', runtimeMin: null, year: 2018 }, res);
    expect(auto).toEqual({ genres: ['drama', 'fantasy', 'scifi'], enrichment: 'tmdb', runtimeMin: 45, year: 2018 });
  });

  it('nomes do TMDB → chaves de assinatura', () => {
    expect(providerKeyFromTmdbName('Amazon Prime Video')).toBe('prime_video');
    expect(providerKeyFromTmdbName('Disney Plus')).toBe('disney_plus');
    expect(providerKeyFromTmdbName('Max')).toBe('max');
    expect(providerKeyFromTmdbName('Globoplay')).toBe('globoplay');
    expect(providerKeyFromTmdbName('Apple TV Plus')).toBe('apple_tv_plus');
    expect(providerKeyFromTmdbName('Apple TV')).toBe('apple_tv_plus');
    expect(providerKeyFromTmdbName('Telecine Amazon Channel')).toBeUndefined();
  });
});

describe('disponibilidade no ranking (RF-38)', () => {
  const base = (id: string, providerKeys: string[] = [], rank = 1): RankItem => ({
    id,
    kind: 'movie',
    status: 'to_watch',
    rank,
    genres: ['comedy', 'romance'],
    attributes: [],
    runtimeMin: null,
    createdAt: new Date('2026-01-01'),
    providerKeys,
  });
  const label = new Map([['netflix', 'Netflix'], ['max', 'Max']]);

  it('título num serviço assinado sobe e explica por quê', () => {
    // 'b' está atrás na fila, mas a disponibilidade pesa mais que um degrau de prioridade
    const ranked = rankTitles([base('a', [], 1), base('b', ['netflix'], 2)], { mode: 'surprise', subgenre: 'romcom' }, {
      taste: {},
      recentlySkipped: new Set(),
      subscriptions: new Set(['netflix']),
      providerLabel: label,
    });
    expect(ranked[0]!.id).toBe('b');
    expect(ranked[0]!.reason).toContain('disponível na Netflix, que você assina');
    expect(ranked[1]!.reason).not.toContain('assina');
  });

  it('sem assinatura cadastrada, sem boost: vale a ordem da fila', () => {
    const ranked = rankTitles([base('b', ['netflix'], 2), base('a', [], 1)], { mode: 'surprise', subgenre: 'romcom' }, {
      taste: {},
      recentlySkipped: new Set(),
    });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
    expect(ranked[1]!.reason).not.toContain('assina');
  });

  it('frase com dois serviços', () => {
    expect(availabilityPhrase(['netflix', 'max'], label)).toBe('disponível na Netflix e na Max, que você assina');
  });

  it('"Continuar": entre listas em andamento, prefere a com próximo item disponível', () => {
    const list = (id: string, available: boolean, when: string) => ({
      id,
      pinned: false,
      lastActivity: new Date(when),
      items: [
        { id: `${id}-1`, status: 'watched' as const, position: 0 },
        { id: `${id}-2`, status: 'to_watch' as const, position: 1, available },
      ],
    });
    const pick = pickContinue([list('recente', false, '2026-09-28'), list('antiga', true, '2026-09-01')])!;
    expect(pick.listId).toBe('antiga');
    expect(pick.available).toBe(true);
  });
});

describe('perfil incremental ≡ rebuild (RF-34)', () => {
  // PRNG determinístico (mulberry32) para o teste de propriedade ser reproduzível
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SIGNALS: SignalRow['signal'][] = ['watched', 'rated', 'dropped', 'added_to_list', 'accepted', 'skipped'];
  const GENRES: GenreKey[] = ['action', 'comedy', 'drama', 'romance', 'horror', 'scifi', 'documentary'];

  function randomSignals(r: () => number, n: number): SignalRow[] {
    return Array.from({ length: n }, () => {
      const signal = SIGNALS[Math.floor(r() * SIGNALS.length)]!;
      const genres = GENRES.filter(() => r() < 0.35);
      return { signal, value: signal === 'rated' ? 1 + Math.floor(r() * 5) : 1, genres };
    });
  }

  it('200 sequências aleatórias: aplicar em lotes = reconstruir do zero', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const all = randomSignals(r, 1 + Math.floor(r() * 60));
      let sums = {};
      let i = 0;
      while (i < all.length) {
        const size = 1 + Math.floor(r() * 7);
        sums = accumulateTaste(sums, all.slice(i, i + size));
        i += size;
      }
      const incremental = tasteFromSums(sums);
      const rebuilt = tasteFromSignals(all);
      expect(Object.keys(incremental).sort()).toEqual(Object.keys(rebuilt).sort());
      for (const g of Object.keys(rebuilt) as GenreKey[]) expect(Math.abs(incremental[g]! - rebuilt[g]!)).toBeLessThanOrEqual(0.001);
    }
  });

  it('a ordem dos sinais não muda o perfil', () => {
    const r = rng(42);
    const all = randomSignals(r, 40);
    const shuffled = [...all].sort(() => r() - 0.5);
    const a = tasteFromSignals(all);
    const b = tasteFromSignals(shuffled);
    for (const g of Object.keys(a) as GenreKey[]) expect(Math.abs(a[g]! - b[g]!)).toBeLessThanOrEqual(0.001);
  });
});

describe('RF-48: colunas de livro (Open Library)', () => {
  it('gêneros vêm dos assuntos; sem duração; marcador openlibrary', () => {
    const book = { provider: 'openlibrary' as const, externalId: 'ol:OL1W', title: 'Livro', url: 'https://openlibrary.org/works/OL1W', year: 1998, subjects: ['Poesia brasileira'] };
    expect(columnsFromResolution(book)).toEqual({ genres: ['poetry'], runtimeMin: null, year: 1998, enrichment: 'openlibrary' });
    expect(enrichmentUpdate({ genres: [], enrichment: 'none', runtimeMin: null, year: null }, book)).toEqual({ genres: ['poetry'], enrichment: 'openlibrary', runtimeMin: null, year: 1998 });
  });
});
