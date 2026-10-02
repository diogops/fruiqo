// "Com a mesma pegada de X": peso das palavras-chave, prova mínima de semelhança e nota.
import { describe, expect, it } from 'vitest';
import { hasEvidence, keywordOverlap, referenceScore, searchKeywords, weighKeywords, type RefTarget } from '../../src/library/tonight-reference.js';

const N = 1_000_000;
// 1 = "time travel" (ampla), 2 = "missing child" (média), 3 = "time loop" (específica), 4 = de cadastro
const keywords = weighKeywords(
  [
    { id: 1, name: 'time travel' },
    { id: 2, name: 'missing child' },
    { id: 3, name: 'time loop' },
    { id: 4, name: 'woman director' },
    { id: 5, name: 'lake' },
  ],
  new Map([
    [1, 9_000],
    [2, 1_200],
    [3, 150],
    [4, 20_000],
    [5, 800],
  ]),
  N,
);
const ref: RefTarget = { mediaType: 'movie', genreIds: [27, 53, 9648], keywords };

describe('palavras-chave de X', () => {
  it('específica pesa mais; ampla × 0,3; de cadastro não conta', () => {
    const w = new Map(keywords.map((k) => [k.id, k]));
    expect(w.get(3)!.cls).toBe('specific');
    expect(w.get(1)!.cls).toBe('broad');
    expect(w.get(4)!.w).toBe(0);
    expect(w.get(3)!.w).toBeGreaterThan(w.get(2)!.w);
    expect(w.get(2)!.w).toBeGreaterThan(w.get(1)!.w);
  });

  it('para o /discover: só as que contam e não são amplas, da mais específica', () => {
    expect(searchKeywords(keywords).map((k) => k.id)).toEqual([3, 5, 2]);
  });

  it('semelhança exige 1 específica ou 2 médias em comum', () => {
    expect(keywordOverlap(keywords, [1])).toBe(0);
    expect(keywordOverlap(keywords, [2])).toBe(0);
    expect(keywordOverlap(keywords, [2, 5])).toBeGreaterThan(0);
    expect(keywordOverlap(keywords, [3])).toBeGreaterThan(0);
  });
});

describe('nota de semelhança', () => {
  const base = { mediaType: 'movie' as const, genreIds: [27, 9648], voteAverage: 7, voteCount: 2_000 };

  it('recomendação com tema em comum vence o genérico; comédia de animação é penalizada', () => {
    const fiel = referenceScore({ ...base, recPos: 0, keywordIds: [3, 2] }, ref);
    const generico = referenceScore({ ...base, keywordIds: [1] }, ref);
    const desenho = referenceScore({ ...base, genreIds: [16, 35], recPos: 0, keywordIds: [3] }, ref);
    expect(fiel).toBeGreaterThan(generico);
    expect(fiel).toBeGreaterThan(desenho);
  });

  it('sem nenhuma prova (nem tema, nem recomendação, nem IA), o candidato sai; equipe só com 2 gêneros de X', () => {
    expect(hasEvidence({ ...base, keywordIds: [1] }, ref)).toBe(false);
    expect(hasEvidence({ ...base, aiPos: 3 }, ref)).toBe(true);
    expect(hasEvidence({ ...base, crew: true }, ref)).toBe(true);
    // mesma equipe com um gênero só em comum não basta
    expect(hasEvidence({ ...base, genreIds: [18, 27], crew: true }, ref)).toBe(false);
    // semelhante do TMDB só com gênero em comum e palavra-chave que conte
    expect(hasEvidence({ ...base, simPos: 0, keywordIds: [1] }, ref)).toBe(false);
    expect(hasEvidence({ ...base, simPos: 0, keywordIds: [2] }, ref)).toBe(true);
  });
});
