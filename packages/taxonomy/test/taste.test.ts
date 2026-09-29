import { describe, expect, it } from 'vitest';
import { genreTermsIn, interpretTasteStatement } from '../src/index.js';

describe('RF-43: resumo de gosto interpretado por regras', () => {
  it('separa o que gosta do que não gosta', () => {
    const r = interpretTasteStatement('Gosto de séries de true crime e suspense psicológico, mas não gosto de terror.');
    expect(r.likedSubgenres).toEqual(expect.arrayContaining(['true_crime', 'psych_thriller']));
    expect(r.dislikes).toContain('horror');
    expect(r.likes).not.toContain('horror');
  });

  it('subgênero citado não vira os gêneros soltos dele', () => {
    const r = interpretTasteStatement('Odeio comédia romântica. Amo comédia pastelão.');
    expect(r.dislikedSubgenres).toContain('romcom');
    expect(r.likedSubgenres).toContain('slapstick');
    expect(r.dislikes).not.toContain('comedy');
    expect(r.dislikes).not.toContain('romance');
  });

  it('"não perco" é elogio', () => {
    const r = interpretTasteStatement('Não perco um filme de ficção científica; e não de guerra');
    expect(r.likes).toContain('scifi');
    expect(r.dislikes).toContain('war');
  });

  it('texto sem gosto reconhecível devolve vazio', () => {
    expect(interpretTasteStatement('bom dia')).toEqual({ likes: [], dislikes: [], likedSubgenres: [], dislikedSubgenres: [] });
  });
});

describe('genreTermsIn (RF-46)', () => {
  it('separa gêneros/subgêneros do resto do texto', () => {
    expect(genreTermsIn('terror anos 80')).toEqual({ genres: ['horror'], subgenres: [], rest: 'anos 80' });
    expect(genreTermsIn('Comédia romântica')).toEqual({ genres: [], subgenres: ['romcom'], rest: '' });
    const title = genreTermsIn('Amor e Luto');
    expect(title.genres).toEqual(['romance']);
    expect(title.rest).toBe('e luto');
  });
});
