// RF-47: resolução no TMDB que respeita ano e tipo e tolera erro de digitação.
import { describe, expect, it } from 'vitest';
import { matchScore, similarity, STRONG_MATCH } from '../../src/pipeline/resolvers/match.js';
import { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';

function fakeFetch(routes: Record<string, unknown>, seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    seen.push(`${url.pathname}?${url.searchParams.get('query') ?? ''}|${url.searchParams.get('first_air_date_year') ?? ''}`);
    const key = Object.keys(routes).find((k) => {
      const [path, query] = k.split('?');
      return url.pathname.endsWith(path!) && (!query || url.searchParams.get('query') === query);
    });
    if (!key) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('similarity/matchScore', () => {
  it('tolera acento, caixa, pontuação e erro de digitação', () => {
    expect(similarity('Bebe Lontra', 'Bebê Lontra')).toBe(1);
    expect(similarity('DopeFlick', 'Dopeflick')).toBe(1);
    expect(similarity('Back Heron', 'Black Heron')).toBeGreaterThan(0.9);
    expect(similarity('Monstra', 'Dália - Monstra: A História de uma Assassina')).toBeGreaterThanOrEqual(0.8);
    expect(similarity('Duna', 'Casablanca')).toBeLessThan(0.4);
    // contido nos dois, mas cobre mais do título curto
    expect(similarity('Monstro', 'O Monstro')).toBeGreaterThan(similarity('Monstro', 'Assassinos: O Monstro de Bangalore'));
  });

  it('ano divergente em mais de 1 derruba o match para fraco, mesmo com título idêntico', () => {
    const q = { title: 'Monstra', year: 2022, mediaType: 'tv' as const };
    const sameName = matchScore(q, { title: 'Monstra', year: 2026, mediaType: 'tv' });
    const longer = matchScore(q, { title: 'Dália - Monstra: A História de uma Assassina', year: 2022, mediaType: 'tv' });
    expect(sameName).toBeLessThanOrEqual(0.55);
    expect(longer).toBeGreaterThanOrEqual(STRONG_MATCH);
    // ±1 ano ainda é aceitável (lançamento em datas diferentes por país)
    expect(matchScore(q, { title: 'Monstra', year: 2023, mediaType: 'tv' })).toBeGreaterThanOrEqual(STRONG_MATCH);
  });

  it('tipo pedido pesa: série pedida × filme homônimo', () => {
    const q = { title: 'Criada', year: 2021, mediaType: 'tv' as const };
    expect(matchScore(q, { title: 'Criada', year: 2021, mediaType: 'tv' })).toBeGreaterThan(matchScore(q, { title: 'Criada', year: 2021, mediaType: 'movie' }));
  });
});

describe('TmdbResolver.lookupDetailed', () => {
  const hit = (id: number, media: 'tv' | 'movie', name: string, year: number, popularity = 10) =>
    media === 'tv'
      ? { id, media_type: 'tv', name, first_air_date: `${year}-01-01`, popularity, overview: `Sinopse ${id}` }
      : { id, media_type: 'movie', title: name, release_date: `${year}-01-01`, popularity, overview: `Sinopse ${id}` };

  it('homônimo de outro ano vira alternativa; o de mesmo ano é escolhido', async () => {
    const r = new TmdbResolver('k'.repeat(32), fakeFetch({
      '/search/multi?Monstra': { results: [hit(2, 'tv', 'Monstra', 2026, 50), hit(1, 'tv', 'Dália - Monstra: A História de uma Assassina', 2022, 40)] },
    }));
    const res = await r.lookupDetailed({ title: 'Monstra', kind: 'series', year: 2022 });
    expect(res.resolution?.externalId).toBe('tv:1');
    expect(res.score).toBeGreaterThanOrEqual(STRONG_MATCH);
    expect(res.alternatives).toEqual([expect.objectContaining({ tmdbId: 2, mediaType: 'tv', title: 'Monstra', year: 2026, overview: 'Sinopse 2' })]);
  });

  it('erro de digitação: match fraco dispara a busca pela palavra mais longa com ano e tipo', async () => {
    const seen: string[] = [];
    const r = new TmdbResolver('k'.repeat(32), fakeFetch({
      '/search/multi?Back Heron': { results: [hit(9, 'movie', 'Back to the Heron', 2023, 5)] },
      '/search/tv?Heron': { results: [{ ...hit(3, 'tv', 'Black Heron', 2022), media_type: undefined }] },
    }, seen));
    const res = await r.lookupDetailed({ title: 'Back Heron', kind: 'series', year: 2022 });
    expect(res.resolution?.externalId).toBe('tv:3');
    expect(res.resolution?.title).toBe('Black Heron');
    expect(res.alternatives.map((a) => a.tmdbId)).toEqual([9]);
    expect(seen).toContain('/3/search/tv?Heron|2022');
  });

  it('match forte não faz chamada extra; nada encontrado = sem resolução', async () => {
    const seen: string[] = [];
    const r = new TmdbResolver('k'.repeat(32), fakeFetch({ '/search/multi?Mindcatcher': { results: [hit(4, 'tv', 'Mindcatcher', 2017)] } }, seen));
    await r.lookupDetailed({ title: 'Mindcatcher', kind: 'series', year: 2017 });
    expect(seen.filter((s) => s.includes('/search/'))).toHaveLength(1);
    const none = await new TmdbResolver('k'.repeat(32), fakeFetch({ '/search/multi': { results: [] } })).lookupDetailed({ title: 'Nada', kind: 'movie' });
    expect(none).toEqual({ resolution: null, score: null, alternatives: [] });
  });

  it('busca multi separa pessoas de títulos (RF-46)', async () => {
    const r = new TmdbResolver('k'.repeat(32), fakeFetch({
      '/search/multi?Pessoa Teste': { results: [{ id: 7, media_type: 'person', name: 'Pessoa Teste', popularity: 12, known_for_department: 'Acting' }, hit(5, 'movie', 'Pessoa Teste: O Filme', 2020)] },
    }));
    const res = await r.searchMulti('Pessoa Teste');
    expect(res.people).toEqual([{ id: 7, name: 'Pessoa Teste', popularity: 12, department: 'Acting' }]);
    expect(res.titles.map((t) => t.tmdbId)).toEqual([5]);
  });

  it('filmografia da pessoa ignora aparições como "ele mesmo" (talk show, premiação)', async () => {
    const r = new TmdbResolver('k'.repeat(32), fakeFetch({
      '/person/7/combined_credits': {
        cast: [
          { ...hit(1, 'tv', 'Talk Show', 2014, 90), character: 'Self - Guest', genre_ids: [10767] },
          { ...hit(2, 'tv', 'Premiação', 1990, 80), character: 'Himself' },
          { ...hit(3, 'movie', 'Filme de Verdade', 2020, 20), character: 'Capitão' },
        ],
        crew: [{ ...hit(4, 'movie', 'Filme Dirigido', 2019, 10), job: 'Director' }, { ...hit(5, 'movie', 'Produzido', 2018, 50), job: 'Producer' }],
      },
    }));
    expect((await r.personCredits(7)).map((h) => h.title)).toEqual(['Filme de Verdade', 'Filme Dirigido']);
  });
});
