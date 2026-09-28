import { describe, expect, it } from 'vitest';
import { dedupKey, kindGroup, mergePages, normalizeForKey, normalizeText, pageHash } from '../../src/pipeline/dedup.js';

describe('normalização de print', () => {
  it('ignora acento, caixa, espaços e linhas vazias ao gerar o hash', () => {
    const a = 'Top 10 Filmes\n\n1. Ainda Estou Aqui  (2024)\n';
    const b = 'top 10 filmes\n1. Ainda Estou   Aqui (2024)';
    const c = 'Top 10 Filmes\n1. Ainda Estóu Aquí (2024)';
    expect(normalizeText(a)).toBe('top 10 filmes\n1. ainda estou aqui (2024)');
    expect(pageHash(a)).toBe(pageHash(b));
    expect(pageHash(a)).toBe(pageHash(c));
    expect(pageHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prints com conteúdo diferente têm hash diferente', () => {
    expect(pageHash('1. Duna')).not.toBe(pageHash('2. Duna'));
  });
});

describe('chave de item', () => {
  it('tira numeração, bullet, ano entre parênteses, acento e pontuação', () => {
    expect(normalizeForKey('1. Ainda Estou Aqui (2024)')).toBe('ainda estou aqui');
    expect(normalizeForKey('#3 - O Auto da Compadecida!')).toBe('o auto da compadecida');
    expect(normalizeForKey('• Cidade de Deus')).toBe('cidade de deus');
    expect(normalizeForKey('10) Coração Valente')).toBe('coracao valente');
  });

  it('não come número que faz parte do título', () => {
    expect(normalizeForKey('2 Fast 2 Furious')).toBe('2 fast 2 furious');
    expect(normalizeForKey('1917')).toBe('1917');
    expect(normalizeForKey('Toy Story 3')).toBe('toy story 3');
  });

  it('mantém títulos em outros alfabetos', () => {
    expect(normalizeForKey('千と千尋の神隠し')).toBe('千と千尋の神隠し');
  });

  it('filme e série caem no mesmo grupo; música leva o criador', () => {
    expect(kindGroup('movie')).toBe('screen');
    expect(kindGroup('series')).toBe('screen');
    expect(kindGroup('artist')).toBe('music');
    expect(dedupKey({ kind: 'movie', title: 'Dark' })).toBe(dedupKey({ kind: 'series', title: 'dark' }));
    expect(dedupKey({ kind: 'movie', title: 'Duna', creator: 'Denis Villeneuve' })).toBe('screen:duna');
    expect(dedupKey({ kind: 'music_track', title: 'Numb', creator: 'Linkin Park' })).toBe('music:numb|linkin park');
    expect(dedupKey({ kind: 'music_track', title: 'Numb' })).toBe('music:numb');
  });
});

describe('mescla de prints', () => {
  it('remove as linhas repetidas pela sobreposição da rolagem, preservando a ordem', () => {
    const p1 = '1. A\n2. B\n3. C';
    const p2 = '2. B\n3.  c\n4. D';
    expect(mergePages([p1, p2])).toBe('1. A\n2. B\n3. C\n4. D');
  });
});
