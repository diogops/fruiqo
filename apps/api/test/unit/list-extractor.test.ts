import { describe, expect, it } from 'vitest';
import { contextKind, extractListItems, MAX_LIST_ITEMS } from '../../src/pipeline/extractors/list.js';

describe('extração de listas', () => {
  it('lista numerada de filmes em pt-BR, com ruído de UI em volta', () => {
    const text = [
      '9:41',
      'filmesdasemana',
      'Top 5 filmes nacionais para o fim de semana 🍿',
      '1. Cidade de Deus (2002)',
      '2) Ainda Estou Aqui - 2024',
      '03 - Central do Brasil (1998) - Globoplay',
      '#4 O Auto da Compadecida (2000) ⭐ 9.1',
      '5º Bacurau',
      'Curtido por joao.silva e outras 1.234 pessoas',
    ].join('\n');
    const items = extractListItems(text);
    expect(items.map((i) => [i.kind, i.title, i.year])).toEqual([
      ['movie', 'Cidade de Deus', 2002],
      ['movie', 'Ainda Estou Aqui', 2024],
      ['movie', 'Central do Brasil', 1998],
      ['movie', 'O Auto da Compadecida', 2000],
      ['movie', 'Bacurau', undefined],
    ]);
    expect(items.every((i) => i.confidence <= 0.6)).toBe(true);
  });

  it('entende emoji de número, bullets e marcador separado do título pelo OCR', () => {
    const text = ['Séries para maratonar', '1️⃣ Dark', '• Succession', '3.', 'The Bear', '- Severance 📺'].join('\n');
    expect(extractListItems(text).map((i) => [i.kind, i.title])).toEqual([
      ['series', 'Dark'],
      ['series', 'Succession'],
      ['series', 'The Bear'],
      ['series', 'Severance'],
    ]);
  });

  it('playlist: "Música - Artista" é o padrão em contexto musical', () => {
    const text = ['Playlist pra estudar 🎧', '1. Azul da Cor do Mar - Tim Maia', '2. Oceano – Djavan', '3. Numb by Linkin Park'].join('\n');
    expect(extractListItems(text)).toEqual([
      { kind: 'music_track', title: 'Azul da Cor do Mar', creator: 'Tim Maia', confidence: 0.6 },
      { kind: 'music_track', title: 'Oceano', creator: 'Djavan', confidence: 0.6 },
      { kind: 'music_track', title: 'Numb', creator: 'Linkin Park', confidence: 0.6 },
    ]);
  });

  it('playlist com pista "(artista - música)": inverte para "Artista - Música"', () => {
    const text = ['Playlist pra estudar (artista – música) 🎧', '1. Tim Maia - Azul da Cor do Mar', '2. Djavan – Oceano'].join('\n');
    expect(extractListItems(text).map((i) => [i.title, i.creator])).toEqual([
      ['Azul da Cor do Mar', 'Tim Maia'],
      ['Oceano', 'Djavan'],
    ]);
  });

  it('sem contexto: ano indica filme e "A - B" indica música', () => {
    const items = extractListItems('Oppenheimer (2023)\nCaetano Veloso - Sozinho');
    expect(items.map((i) => [i.kind, i.title, i.creator])).toEqual([
      ['movie', 'Oppenheimer', undefined],
      ['music_track', 'Sozinho', 'Caetano Veloso'],
    ]);
  });

  it('não quebra título com número e ignora cabeçalho e frases', () => {
    const text = [
      'Top 3 filmes de 2024:',
      '1. Toy Story 3',
      '2. 1917 (2019)',
      '3. Esse aqui eu vi no cinema com a minha família inteira e todo mundo chorou muito no final',
    ].join('\n');
    expect(extractListItems(text).map((i) => i.title)).toEqual(['Toy Story 3', '1917']);
  });

  it('título terminado em "?" vale em item de lista, mas não em linha solta', () => {
    expect(extractListItems('filmes\n9. Que Horas Ela Volta? (2015)').map((i) => i.title)).toEqual(['Que Horas Ela Volta?']);
    expect(extractListItems('Alguém já viu esse (2015)?')).toEqual([]);
  });

  it('ignora linhas soltas sem marcador (texto corrido)', () => {
    expect(extractListItems('Que semana!\nAmei esse post\nMarquem os amigos')).toEqual([]);
  });

  it(`limita a ${MAX_LIST_ITEMS} itens`, () => {
    const text = ['filmes', ...Array.from({ length: 80 }, (_, i) => `${i + 1}. Filme ${i + 1}`)].join('\n');
    expect(extractListItems(text)).toHaveLength(MAX_LIST_ITEMS);
  });

  it('tipo por contexto: vocabulário predominante', () => {
    expect(contextKind('Melhores FILMES e um documentário')).toBe('movie');
    expect(contextKind('séries e temporadas novas')).toBe('series');
    expect(contextKind('Álbuns do ano')).toBe('music_album');
    expect(contextKind('sem pista nenhuma')).toBeNull();
  });
});

describe('lista "Título: onde assistir" (posts de perfil)', () => {
  // texto sintético no formato dos posts; o 🎬 de cada linha chega como emoji (app) ou lixo do OCR (web)
  const post = (marker: string) =>
    [
      'Siga @perfil.teste',
      `${marker} 6 FILMES DE SUSPENSE PARA VER NUMA NOITE DE CHUVA`,
      'Separei filmes com ideias simples e finais que ninguém espera.',
      'ONDE ASSISTIR:',
      `${marker} A Casa do Lago Escuro: Netflix`,
      `${marker} Silêncio: O Retorno: Plex`,
      `${marker} Ninguém Sai Daqui: Disney+`,
      `${marker} O Farol: Indisponível em streaming no momento`,
      `${marker} Linha Cruzada: Telecine / Universal+`,
      `${marker} Duplo: MGM +`,
      'Qual desses te ganhou só pela ideia?',
    ].join('\n');
  const expected = ['A Casa do Lago Escuro', 'Silêncio: O Retorno', 'Ninguém Sai Daqui', 'O Farol', 'Linha Cruzada', 'Duplo'];

  it.each(['🎬', 'EB', '@', '©'])('marcador %s: só os títulos, sem o serviço nem a manchete', (marker) => {
    const items = extractListItems(post(marker));
    expect(items.map((i) => i.title)).toEqual(expected);
    expect(items.every((i) => i.kind === 'movie')).toBe(true);
  });

  it('sem marcador também funciona; "Título: frase qualquer" não vira item', () => {
    expect(extractListItems(post('').replace(/^ /gm, '')).map((i) => i.title)).toEqual(expected);
    expect(extractListItems('Filmes da semana\nDica: assista com pipoca\nObs: sem spoilers')).toEqual([]);
  });

  it('prefixo curto repetido só vira marcador em linha de item (título de 1 palavra e caixa alta curta continuam)', () => {
    const items = extractListItems(['filmes para ver', 'EU Coraline (2009)', 'EU Up (2009)', 'EU Soul (2020)'].join('\n'));
    expect(items.map((i) => i.title)).toEqual(['Coraline', 'Up', 'Soul']);
    expect(extractListItems('filmes\n• CORALINE (2009)').map((i) => i.title)).toEqual(['CORALINE']);
  });
});
