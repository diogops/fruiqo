// RF-47: importação de .txt (um título por linha, cabeçalhos de seção definem o tipo).
import { describe, expect, it } from 'vitest';
import { extractListItems, extractTextFileItems, sectionHeader } from '../../src/pipeline/extractors/list.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { listNameFromFile } from '../../src/pipeline/process-share.js';

// mesmo formato da lista real que motivou o RF-47 (títulos fictícios): CRLF, sem ano nas 3
// primeiras linhas, ano colado ao título, sem quebra de linha no fim
const SERIES_TXT = [
  'Series:',
  'Bebe Lontra',
  'Olhos que julgam',
  'Chernoville',
  'Uma família quase perfeita(2025)',
  'O pacto(2019)',
  'Incontestável(2019)',
  'Criada(2021)',
  'Amor e Luto(2023)',
  'The Stopout(2022)',
  'Back Heron(2022)',
  'DopeFlick(2021)',
  'O paraíso e a víbora(2021)',
  'A escadaria(2022)',
  'Entre vizinhos(2023)',
  'Em nome da fé(2022)',
  'Mindcatcher(2017)',
  'Monstra(2022)',
].join('\r\n');

describe('extractTextFileItems (RF-47)', () => {
  it('toda linha curta sob "Series:" é item de série, com ou sem ano', () => {
    const items = extractTextFileItems(SERIES_TXT, 'lista series BFR.txt');
    expect(items).toHaveLength(17);
    expect(items.every((i) => i.kind === 'series')).toBe(true);
    expect(items.slice(0, 3).map((i) => [i.title, i.year])).toEqual([
      ['Bebe Lontra', undefined],
      ['Olhos que julgam', undefined],
      ['Chernoville', undefined],
    ]);
    expect(items[3]).toMatchObject({ title: 'Uma família quase perfeita', year: 2025 });
    expect(items[16]).toMatchObject({ title: 'Monstra', year: 2022 });
    // seção declarada: confiança acima do limiar de revisão (a sugestão é aprovar)
    expect(items.every((i) => i.confidence >= 0.5)).toBe(true);
  });

  it('cabeçalhos trocam o tipo; marcadores e linhas decorativas são tratados', () => {
    const items = extractTextFileItems('Filmes:\n1. Filme Um (2020)\n- Filme Dois\n\n-----\nMúsicas:\nCanção Y - Artista X\nSéries\n• Série Z');
    expect(items.map((i) => [i.title, i.kind])).toEqual([
      ['Filme Um', 'movie'],
      ['Filme Dois', 'movie'],
      ['Canção Y', 'music_track'],
      ['Série Z', 'series'],
    ]);
    expect(items[2]!.creator).toBe('Artista X');
  });

  it('sem cabeçalho: o tipo vem do vocabulário do arquivo ou do nome dele', () => {
    const items = extractTextFileItems('Dark\nBaby Driver (2017)', 'minhas series.txt');
    expect(items.map((i) => i.kind)).toEqual(['series', 'series']);
    expect(items[0]!.confidence).toBeLessThan(0.65);
    const unknown = extractTextFileItems('Algo\nOutra coisa');
    expect(unknown.map((i) => i.kind)).toEqual(['other', 'other']);
  });

  it('linha longa demais ou com link não vira item', () => {
    const items = extractTextFileItems('Filmes:\nhttps://exemplo.com/lista\nesse aqui é um comentário comprido demais que claramente não é o título de nenhuma obra que exista\nAmélie');
    expect(items.map((i) => i.title)).toEqual(['Amélie']);
  });

  it('o extrator heurístico usa o modo .txt quando a origem é text_file', async () => {
    const items = await new HeuristicExtractor().extract({ userId: 'u', platform: 'other', origin: 'text_file', text: SERIES_TXT, fileName: 'x.txt' });
    expect(items).toHaveLength(17);
  });
});

describe('cabeçalhos de seção', () => {
  it('reconhece só cabeçalho de tipo; título com dois-pontos não é cabeçalho', () => {
    expect(sectionHeader('Series:')).toBe('series');
    expect(sectionHeader('## Filmes')).toBe('movie');
    expect(sectionHeader('Músicas favoritas:')).toBe('music_track');
    expect(sectionHeader('Playlist:')).toBe('music_track');
    expect(sectionHeader('Minha playlist')).toBe('music_track');
    expect(sectionHeader('Outros:')).toBeNull();
    expect(sectionHeader('Missão: Impossível')).toBeUndefined();
    expect(sectionHeader('Chernoville')).toBeUndefined();
  });

  it('texto colado: seção "Séries:" faz as linhas curtas seguintes virarem itens', () => {
    const items = extractListItems('Minhas indicações\nSéries:\nDark\nThe Office\n');
    expect(items.map((i) => [i.title, i.kind])).toEqual([
      ['Dark', 'series'],
      ['The Office', 'series'],
    ]);
  });
});

it('nome da lista proposta vem do nome do arquivo', () => {
  expect(listNameFromFile('lista series BFR.txt')).toBe('lista series BFR');
  expect(listNameFromFile('filmes_2024.TXT')).toBe('filmes 2024');
  expect(listNameFromFile(undefined)).toBeNull();
});

describe('RF-48: livros', () => {
  it('cabeçalho "Livros:" define o tipo; "Título - Autor" separa o autor', () => {
    const items = extractTextFileItems('Livros:\nO Relógio de Areia\nVento Sul - Marta Quintela\nCartas do Sertão (1998)\n1984\n');
    expect(items.map((i) => [i.kind, i.title, i.creator ?? null, i.year ?? null])).toEqual([
      ['book', 'O Relógio de Areia', null, null],
      ['book', 'Vento Sul', 'Marta Quintela', null],
      ['book', 'Cartas do Sertão', null, 1998],
      ['book', '1984', null, null],
    ]);
  });

  it('cabeçalhos de livro em pt e en', () => {
    for (const h of ['Livros:', 'Books', '## Leituras', 'Livros para ler:', 'Meus livros favoritos']) expect(sectionHeader(h)).toBe('book');
  });

  it('contexto de leitura sem cabeçalho: "Título by Autor" também vale', () => {
    const items = extractListItems('Livros que quero ler este ano:\n1. Vento Sul by Marta Quintela\n2. Nove Estrelas');
    expect(items.map((i) => [i.kind, i.title, i.creator ?? null])).toEqual([
      ['book', 'Vento Sul', 'Marta Quintela'],
      ['book', 'Nove Estrelas', null],
    ]);
  });

  it('seções "Músicas:" e "Playlist:": "A - B" é "Música - Artista"', () => {
    for (const header of ['Músicas:', 'Playlist:']) {
      const items = extractTextFileItems(`${header}\nAquarela - Toquinho\nÁguas de Março - Tom Jobim`);
      expect(items.map((i) => [i.kind, i.title, i.creator])).toEqual([
        ['music_track', 'Aquarela', 'Toquinho'],
        ['music_track', 'Águas de Março', 'Tom Jobim'],
      ]);
    }
  });

  it('cabeçalho "Artista - Música:" inverte a ordem e abre seção de música', () => {
    expect(sectionHeader('Artista - Música:')).toBe('music_track');
    const items = extractTextFileItems('Artista - Música:\nMarta Quintela - Vento Sul');
    expect(items[0]).toMatchObject({ kind: 'music_track', creator: 'Marta Quintela', title: 'Vento Sul' });
  });

  it('sem contexto musical nenhum, "A - B" segue a convenção de vídeo "Artista - Música"', () => {
    const items = extractTextFileItems('Marta Quintela - Vento Sul');
    expect(items[0]).toMatchObject({ kind: 'music_track', creator: 'Marta Quintela', title: 'Vento Sul' });
  });
});
