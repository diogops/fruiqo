import { describe, expect, it } from 'vitest';
import { autoRating } from '../../src/library/auto-rating.js';
import type { FitContext } from '../../src/library/fit.js';

const ctx = (over: Partial<FitContext> = {}): FitContext => ({
  declared: new Map(),
  likedSubgenres: new Set(),
  dislikedSubgenres: new Set(),
  signals: {},
  notes: new Map(),
  favorites: [],
  ...over,
});

describe('D-23: nota automática (local, sem LLM)', () => {
  it('sem gosto conhecido, é a nota geral do TMDB na escala 0..5', () => {
    expect(autoRating({ title: 'X', genres: ['drama'], generalRating: 8.2 }, ctx())).toBe(4.1);
  });

  it('o gosto move a nota a partir da base (até ±1,5 estrela) e fica em 0,5..5', () => {
    const likes = ctx({ signals: { drama: 1 } });
    const hates = ctx({ signals: { drama: -1 } });
    const liked = autoRating({ title: 'X', genres: ['drama'], generalRating: 7 }, likes)!;
    const hated = autoRating({ title: 'X', genres: ['drama'], generalRating: 7 }, hates)!;
    expect(liked).toBeGreaterThan(3.5);
    expect(hated).toBeLessThan(3.5);
    expect(autoRating({ title: 'X', genres: ['drama'], generalRating: 10 }, likes)).toBeLessThanOrEqual(5);
    expect(autoRating({ title: 'X', genres: ['drama'], generalRating: 0 }, hates)).toBeGreaterThanOrEqual(0.5);
  });

  it('favorito vale nota alta; sem nota geral e sem gêneros não inventa nota', () => {
    const fav = ctx({ favorites: [{ title: 'Fav', genres: [], rating: 5, tmdbId: 1, mediaType: 'movie' }] });
    expect(autoRating({ title: 'Fav', genres: [], tmdbId: 1, mediaType: 'movie' }, fav)).toBe(4.5);
    expect(autoRating({ title: 'Nada', genres: [] }, ctx())).toBeNull();
  });
});
