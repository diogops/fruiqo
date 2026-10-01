// D-25: o pedido vira plano (gêneros todos/algum/nenhum, atributos, década) e o servidor busca.
import { describe, expect, it } from 'vitest';
import { localPlan, planIsEmpty, planLabel, requiredAttrs, sanitizePlan } from '../../src/library/tonight-plan.js';
import { adjustedQuality, compareCandidates, discoverParams, franchiseKey, GENRE_LABEL, planAccepts, rate, reasonFor, withSelectedGenre } from '../../src/library/tonight-video.js';

const label = (g: string) => GENRE_LABEL.get(g) ?? g;

describe('parser local do pedido', () => {
  it('"ação... scifi... inteligente" = os dois gêneros ao mesmo tempo + faz pensar', () => {
    const p = localPlan('quero assistir um bom filme de ação, mas que seja scifi e que seja inteligente');
    expect(p).toMatchObject({ genresAll: ['action', 'scifi'], genresAny: [], genresNone: [], prefer: ['thought_provoking'], unmapped: [] });
    expect(planLabel(p, label)).toBe('Ação + Ficção científica · faz pensar');
  });

  it('"ou" vira alternativa; "sem/nada de" vira exclusão; década', () => {
    expect(localPlan('comédia ou romance, nada de terror')).toMatchObject({ genresAll: [], genresAny: ['comedy', 'romance'], genresNone: ['horror'] });
    const p = localPlan('um suspense dos anos 90 sem reviravolta');
    expect(p).toMatchObject({ genresAll: ['thriller'], decade: 1990, avoid: ['plot_twist'], prefer: [] });
    expect(planLabel(p, label)).toBe('Suspense/Thriller · anos 90 · nada com reviravolta');
  });

  it('"estou cansado, quero algo leve e curto": leve + curto, sem IA; a busca usa pistas de gênero e duração', () => {
    const p = localPlan('estou cansado, quero algo leve e curto');
    expect(p).toMatchObject({ prefer: ['light_tone', 'short'], genresAll: [], unmapped: [] });
    const params = discoverParams({ media: 'movie', source: 'best', page: 1, themes: [] }, p, { providerIds: [8], keywordIds: [], softGenres: ['crime'] })!;
    // pista de "leve" (qualquer um): comédia, família, romance, aventura; sem terror/guerra/suspense/crime; até 100 min
    expect(params).toMatchObject({ genreIds: [35, 10751, 10749, 12], anyGenre: true, withoutGenreIds: [27, 10752, 53, 80], maxRuntime: 100, providerIds: [8] });
    expect(discoverParams({ media: 'movie', source: 'recent', page: 1, themes: [] }, p, { providerIds: [], keywordIds: [], softGenres: [] })).toMatchObject({ minVotes: 200 });
  });

  it('o que não entendeu fica em "unmapped" (motivo para chamar a IA)', () => {
    const p = localPlan('algo noir cyberpunk');
    expect(p.unmapped).toEqual(['noir', 'cyberpunk']);
    expect(planIsEmpty(p)).toBe(true);
    expect(localPlan('quero ver um filme hoje').unmapped).toEqual([]);
  });

  it('plano da IA: só enums conhecidos, sem contradição; gênero do select entra como obrigatório', () => {
    const p = sanitizePlan({ genresAll: ['scifi', 'inventado'], genresNone: ['scifi', 'horror'], prefer: ['thought_provoking', 'x'], decade: 1985, unmapped: ['a'] });
    expect(p).toEqual({ genresAll: [], genresAny: [], genresNone: ['scifi', 'horror'], prefer: ['thought_provoking'], avoid: [], unmapped: ['a'] });
    expect(withSelectedGenre(localPlan('algo leve'), 'comedy').genresAll).toEqual(['comedy']);
    expect(withSelectedGenre(localPlan('comédia'), 'comedy').genresAll).toEqual(['comedy']);
  });
});

describe('franquia (um título por franquia em cada lote)', () => {
  it('nome antes de ":", sem número de sequência', () => {
    expect(franchiseKey('Planeta dos Macacos: A Origem')).toBe(franchiseKey('Planeta dos Macacos: O Confronto'));
    expect(franchiseKey('Mad Max 2: A Caçada Continua')).toBe('mad max');
    expect(franchiseKey('Mad Max')).toBe('mad max');
    expect(franchiseKey('Duna: Parte 2')).toBe(franchiseKey('Duna'));
    expect(franchiseKey('Matrix')).not.toBe(franchiseKey('A Origem'));
  });
});

describe('pontuação e motivo (só evidência)', () => {
  const plan = localPlan('ação e scifi inteligente');
  const item = { tmdbId: 1, mediaType: 'movie' as const, kind: 'movie' as const, title: 'X', cast: [], inLibrary: null, matchedBy: 'browse' as const, generalRating: 8.1, generalVotes: 20000, autoRating: 4.2 };

  it('plano filtra: todos, algum, nenhum', () => {
    expect(planAccepts(plan, ['action', 'scifi', 'drama'])).toBe(true);
    expect(planAccepts(plan, ['action'])).toBe(false);
    expect(planAccepts(localPlan('comédia ou romance sem terror'), ['romance'])).toBe(true);
    expect(planAccepts(localPlan('comédia ou romance sem terror'), ['romance', 'horror'])).toBe(false);
  });

  it('dois índices: ordena primeiro pelo pedido, depois pelo perfil; a nota só desempata; Minha Área antes', () => {
    const base = { page: 1, anime: false, genres: ['action', 'scifi'] as const };
    const themedLowRating = rate({ ...base, genres: ['action', 'scifi'], item: { ...item, generalRating: 6.5, autoRating: 3 }, source: 'theme', themes: ['thought_provoking'] }, plan);
    const famousNoTheme = rate({ ...base, genres: ['action', 'scifi'], item: { ...item, generalRating: 9.2, autoRating: 4.9 }, source: 'best', themes: [] }, plan);
    const sameFitBetterProfile = rate({ ...base, genres: ['action', 'scifi'], item: { ...item, generalRating: 6, autoRating: 4.8 }, source: 'theme', themes: ['thought_provoking'] }, plan);
    const fromList = rate({ ...base, genres: ['action', 'scifi'], item: { ...item, autoRating: 2 }, source: 'list', themes: [] }, plan);
    expect(themedLowRating.fit).toBe(1);
    // sem palavra-chave, mas ficção científica é pista de "faz pensar" (evidência mais fraca: 0,6)
    expect(famousNoTheme.fit).toBeCloseTo(0.8);
    expect(sameFitBetterProfile.profile).toBeCloseTo(0.96);
    const order = [famousNoTheme, themedLowRating, fromList, sameFitBetterProfile].sort(compareCandidates);
    expect(order).toEqual([fromList, sameFitBetterProfile, themedLowRating, famousNoTheme]);
    // sem pedido, todos empatam no pedido e o perfil decide
    const free = localPlan('');
    expect(rate({ ...base, genres: ['drama'], item, source: 'best', themes: [] }, free).fit).toBe(1);
    expect(adjustedQuality(9.5, 20)).toBeLessThan(adjustedQuality(8, 20000));
  });

  it('motivo: lista, gêneros pedidos, tema, nota e gosto', () => {
    // sem "combina com o seu gosto"; atributo só com prova (palavra-chave ou duração): gênero parecido não basta
    expect(reasonFor({ item, source: 'list', page: 1, anime: false, genres: ['action', 'scifi'], themes: [] }, plan)).toBe(
      'Na sua lista · ação e ficção científica · nota 8,1 no TMDB',
    );
    expect(reasonFor({ item, source: 'best', page: 1, anime: false, genres: ['comedy'], themes: [] }, localPlan('algo leve e curto'))).toBe('Nota 8,1 no TMDB');
    expect(reasonFor({ item, source: 'best', page: 1, anime: false, genres: ['comedy'], themes: [], runtimeOk: true }, localPlan('algo leve e curto'))).toBe('Curto · nota 8,1 no TMDB');
    expect(reasonFor({ item: { ...item, autoRating: 3 }, source: 'theme', page: 1, anime: false, genres: ['action', 'scifi'], themes: ['thought_provoking'] }, plan)).toBe(
      'Ação e ficção científica · tema: faz pensar · nota 8,1 no TMDB',
    );
  });
});

describe('"baseado em história real que seja inteligente" (obrigatório com prova)', () => {
  const plan = localPlan('quero um filme baseado em historia real que seja inteligente');
  const opts = { providerIds: [8], keywordIds: [11], softGenres: [] as never[], requiredKeywordIds: [9672, 5565] };

  it('história real é obrigatória; inteligente é só preferência', () => {
    expect(plan.prefer).toEqual(expect.arrayContaining(['true_story', 'thought_provoking']));
    expect(requiredAttrs(plan)).toEqual(['true_story']);
    expect(plan.unmapped).toEqual([]);
  });

  it('toda fonte busca só com a palavra-chave de história real; sem o ID dela, não busca', () => {
    expect(discoverParams({ media: 'movie', source: 'best', page: 1, themes: [] }, plan, opts)).toMatchObject({ keywordIds: [9672, 5565] });
    expect(discoverParams({ media: 'movie', source: 'recent', page: 1, themes: [] }, plan, opts)).toMatchObject({ keywordIds: [9672, 5565] });
    expect(discoverParams({ media: 'movie', source: 'theme', page: 1, themes: [] }, plan, opts)).toBeNull();
    expect(discoverParams({ media: 'movie', source: 'best', page: 1, themes: [] }, plan, { ...opts, requiredKeywordIds: [] })).toBeNull();
  });

  it('o motivo não diz "história real" nem "faz pensar" só porque é drama', () => {
    const item = { tmdbId: 1, mediaType: 'movie' as const, kind: 'movie' as const, title: 'X', cast: [], inLibrary: null, matchedBy: 'title' as const };
    expect(reasonFor({ item, source: 'list', page: 1, anime: false, genres: ['drama'], themes: [] }, plan)).toBe('Na sua lista');
    expect(reasonFor({ item, source: 'list', page: 1, anime: false, genres: ['drama'], themes: ['true_story'] }, plan)).toBe('Na sua lista · tema: história real');
  });
});

describe('três índices: pedido → mais assistidos → perfil', () => {
  const plan = localPlan('um suspense');
  const item = { tmdbId: 1, mediaType: 'movie' as const, kind: 'movie' as const, title: 'X', cast: [], inLibrary: null, matchedBy: 'browse' as const, generalRating: 7 };
  const c = (votes: number, auto: number) => rate({ item: { ...item, generalVotes: votes, autoRating: auto }, source: 'best', page: 1, anime: false, genres: ['thriller'], themes: [] }, plan);

  it('mesmo pedido: o mais assistido vem antes, mesmo com perfil um pouco menor', () => {
    const niche = c(300, 4.9);
    const famous = c(25_000, 4.2);
    expect(famous.popular).toBe(1);
    expect(niche.popular).toBeLessThan(0.6);
    expect([niche, famous].sort(compareCandidates)).toEqual([famous, niche]);
  });

  it('mesma faixa de mais assistidos: o perfil decide', () => {
    const a = c(20_000, 3);
    const b = c(30_000, 4.8);
    expect([a, b].sort(compareCandidates)).toEqual([b, a]);
  });
});

describe('origem e investigação ("um suspense nórdico com detetive")', () => {
  it('origem vira requisito (país de origem no TMDB) e detetive vira tema; nada fica sem entender', () => {
    const p = localPlan('um suspense nórdico com detetive');
    expect(p).toMatchObject({ genresAll: ['thriller'], origins: ['nordic'], prefer: ['detective'], unmapped: [] });
    expect(planLabel(p, label)).toBe('Suspense/Thriller · investigação · nórdico');
    const params = discoverParams({ media: 'movie', source: 'best', page: 1, themes: [] }, p, { providerIds: [], keywordIds: [], softGenres: [] })!;
    expect(params.originCountries).toEqual(['SE', 'NO', 'DK', 'FI', 'IS']);
  });

  it('"série coreana", "filme nacional"; a IA só devolve origens conhecidas', () => {
    expect(localPlan('uma série coreana leve').origins).toEqual(['korean']);
    expect(localPlan('um filme nacional de comédia').origins).toEqual(['brazilian']);
    expect(localPlan('um filme de comédia').origins).toBeUndefined();
    expect(localPlan('um filme que me faça pensar sobre inteligência artificial')).toMatchObject({ prefer: ['thought_provoking', 'ai_topic'], unmapped: [] });
    expect(requiredAttrs(localPlan('filme sobre robôs'))).toEqual(['ai_topic']);
    expect(localPlan('uma comédia leve e curta')).toMatchObject({ genresAll: ['comedy'], prefer: ['light_tone', 'short'], unmapped: [] });
    expect(sanitizePlan({ origins: ['nordic', 'marte'] }).origins).toEqual(['nordic']);
  });

  it('o motivo cita a origem só quando comprovada', () => {
    const p = localPlan('um suspense nórdico');
    const item = { tmdbId: 1, mediaType: 'movie' as const, kind: 'movie' as const, title: 'X', cast: [], inLibrary: null, matchedBy: 'browse' as const };
    expect(reasonFor({ item, source: 'best', page: 1, anime: false, genres: ['thriller'], themes: [], originOk: true }, p)).toBe('Suspense/thriller · nórdico');
    expect(reasonFor({ item, source: 'best', page: 1, anime: false, genres: ['thriller'], themes: [] }, p)).toBe('Suspense/thriller');
  });
});

describe('"igual a X" (obra de referência)', () => {
  it('o nome da obra vira referência e não gênero ("Os Horrores de Caddo Lake" não é pedido de terror)', () => {
    const p = localPlan('filmes iguais os horrores de caddo lake, que tenham a mesma premissa, que enganam até o fim');
    expect(p.references).toEqual(['horrores de caddo lake']);
    expect(p.genresAll).toEqual([]);
    expect(p.prefer).toContain('plot_twist');
    expect(planLabel(p, label)).toContain('parecido com horrores de caddo lake');
  });

  it('"parecido com Dark", "no estilo de Coerência"; "parecido com algo leve" não é obra', () => {
    expect(localPlan('uma série parecida com dark').references).toEqual(['dark']);
    expect(localPlan('um filme no estilo de coerência').references).toEqual(['coerencia']);
    expect(localPlan('algo parecido com algo leve').references).toBeUndefined();
    expect(sanitizePlan({ references: ['  Caddo Lake ', 'x'] }).references).toEqual(['Caddo Lake']);
  });

  it('pontuação: IA (premissa) antes das recomendações do TMDB; o resto não entra', () => {
    const p = localPlan('igual a caddo lake');
    const item = { tmdbId: 1, mediaType: 'movie' as const, kind: 'movie' as const, title: 'X', cast: [], inLibrary: null, matchedBy: 'browse' as const };
    const ai = rate({ item, source: 'ai', page: 1, anime: false, genres: [], themes: [] }, p);
    const tmdb = rate({ item, source: 'similar', page: 1, anime: false, genres: [], themes: [], similarTo: 'Caddo Lake' }, p);
    expect(ai.fit).toBe(1);
    expect(tmdb.fit).toBeCloseTo(0.9);
    expect(reasonFor({ item, source: 'similar', page: 1, anime: false, genres: [], themes: [], similarTo: 'Caddo Lake' }, p)).toBe('Parecido com Caddo Lake');
  });
});

