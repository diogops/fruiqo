// RF-48: assuntos da Open Library → gêneros da taxonomia (determinístico, local).
import { describe, expect, it } from 'vitest';
import { GENRES, genresFromSubjects, MAX_BOOK_GENRES } from '../src/index.js';

describe('genresFromSubjects', () => {
  it('mapeia assuntos em inglês e português', () => {
    expect(genresFromSubjects(['Science fiction', 'Dystopias'])).toEqual(['scifi']);
    expect(genresFromSubjects(['Poesia brasileira'])).toEqual(['poetry']);
    expect(genresFromSubjects(['Biography', 'Memórias'])).toEqual(['biography']);
    expect(genresFromSubjects(['Self-help techniques'])).toEqual(['self_help']);
  });

  it('"ficção científica" não vira não ficção', () => {
    expect(genresFromSubjects(['Science fiction'])).not.toContain('nonfiction');
  });

  it('"romance" em português é narrativa (drama), não história de amor', () => {
    expect(genresFromSubjects(['Romance brasileiro'])).toEqual(['drama']);
    expect(genresFromSubjects(['Love stories'])).toEqual(['romance']);
  });

  it('ficção genérica só vira drama quando não há nada mais específico', () => {
    expect(genresFromSubjects(['Fiction'])).toEqual(['drama']);
    expect(genresFromSubjects(['Fiction', 'Fantasy'])).toEqual(['fantasy']);
  });

  it('"History and criticism" (estudo sobre a obra) não vira história', () => {
    expect(genresFromSubjects(['Fiction', 'History and criticism', 'Brazilian fiction'])).toEqual(['drama']);
  });

  it('limita a quantidade e ignora assunto desconhecido', () => {
    const many = genresFromSubjects(['Horror', 'Fantasy', 'Science fiction', 'Mystery', 'Humor', 'Poetry']);
    expect(many.length).toBe(MAX_BOOK_GENRES);
    expect(genresFromSubjects(['Accessible book', 'Protected DAISY'])).toEqual([]);
  });

  it('gêneros novos de livro têm rótulo em pt-BR', () => {
    const labels = new Map(GENRES.map((g) => [g.key, g.label]));
    for (const key of ['biography', 'nonfiction', 'poetry', 'young_adult', 'self_help'] as const) expect(labels.get(key)).toBeTruthy();
  });
});
