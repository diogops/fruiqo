import { interpretMood, type GenreKey } from '@fruiqo/taxonomy';
import { describe, expect, it } from 'vitest';
import { listNameFromOcr } from '../../src/library/list-name.js';
import { pickContinue, rankTitles, tasteFromSignals, type RankItem } from '../../src/library/ranking.js';

let seq = 0;
function item(id: string, genres: GenreKey[], extra: Partial<RankItem> = {}): RankItem {
  seq++;
  return {
    id,
    kind: 'movie',
    status: 'to_watch',
    priority: 1,
    genres,
    attributes: [],
    runtimeMin: null,
    createdAt: new Date(2026, 0, 1, 0, seq),
    ...extra,
  };
}

const ctx = { taste: {}, recentlySkipped: new Set<string>() };

const LIBRARY = [
  item('romcom', ['comedy', 'romance']),
  item('slapstick', ['comedy']),
  item('drama-romance', ['drama', 'romance']),
  item('heavy-drama', ['drama']),
  item('dramedy', ['comedy', 'drama']),
  item('horror', ['horror']),
  item('thriller', ['thriller', 'mystery']),
  item('no-genre', []),
];

describe('rankTitles: Surpreenda-me', () => {
  it('comédia romântica prioriza comédia + romance e não traz o que não combina', () => {
    const ranked = rankTitles(LIBRARY, { mode: 'surprise', subgenre: 'romcom' }, ctx);
    expect(ranked[0]).toMatchObject({ id: 'romcom', reason: expect.stringContaining('Comédia romântica, como você pediu') });
    expect(ranked.map((r) => r.id)).not.toContain('horror');
    expect(ranked.map((r) => r.id)).not.toContain('thriller');
  });

  it('comédia pastelão não aceita drama nem romance', () => {
    const ids = rankTitles(LIBRARY, { mode: 'surprise', subgenre: 'slapstick' }, ctx).map((r) => r.id);
    expect(ids[0]).toBe('slapstick');
    expect(ids).not.toContain('dramedy');
    expect(ids).not.toContain('romcom');
  });

  it('por gênero base', () => {
    const ids = rankTitles(LIBRARY, { mode: 'surprise', genre: 'horror' }, ctx).map((r) => r.id);
    expect(ids[0]).toBe('horror');
  });

  it('sem gênero só completa a lista quando há poucas opções, com motivo honesto', () => {
    const ranked = rankTitles(LIBRARY, { mode: 'surprise', genre: 'horror' }, ctx);
    const noGenre = ranked.find((r) => r.id === 'no-genre');
    expect(noGenre?.reason).toMatch(/sem gênero cadastrado/);
    const many = rankTitles(
      [item('c1', ['comedy']), item('c2', ['comedy']), item('c3', ['comedy']), item('x', [])],
      { mode: 'surprise', genre: 'comedy' },
      ctx,
    );
    expect(many.map((r) => r.id)).not.toContain('x');
  });

  it('é determinístico: mesma entrada, mesma ordem; empate desempata por prioridade', () => {
    const a = rankTitles(LIBRARY, { mode: 'surprise', genre: 'comedy' }, ctx);
    const b = rankTitles([...LIBRARY].reverse(), { mode: 'surprise', genre: 'comedy' }, ctx);
    expect(a).toEqual(b);
    const tie = rankTitles(
      [item('low', ['comedy'], { priority: 0 }), item('high', ['comedy'], { priority: 3 })],
      { mode: 'surprise', genre: 'comedy' },
      ctx,
    );
    expect(tie[0]!.id).toBe('high');
  });

  it('ignora assistidos/abandonados e respeita o tipo pedido', () => {
    const lib = [item('seen', ['comedy'], { status: 'watched' }), item('show', ['comedy'], { kind: 'series' }), item('film', ['comedy'])];
    const ids = rankTitles(lib, { mode: 'surprise', genre: 'comedy' }, { ...ctx, kinds: ['series'] }).map((r) => r.id);
    expect(ids).toEqual(['show']);
  });

  it('pulado recentemente cai no ranking', () => {
    const lib = [item('a', ['comedy']), item('b', ['comedy'])];
    const ids = rankTitles(lib, { mode: 'surprise', genre: 'comedy' }, { ...ctx, recentlySkipped: new Set(['a']) }).map((r) => r.id);
    expect(ids).toEqual(['b', 'a']);
  });
});

describe('rankTitles: Como estou', () => {
  it('"estou triste, sofrendo por amor" → levanta o astral, evita romance e drama pesado', () => {
    const intent = interpretMood('estou triste, sofrendo por amor');
    expect(intent.need).toBe('uplifting');
    expect(intent.avoid).toContain('romance_centric');
    const ranked = rankTitles(LIBRARY, { mode: 'mood', intent }, ctx);
    const ids = ranked.map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining(['dramedy', 'slapstick']));
    for (const banned of ['romcom', 'drama-romance', 'heavy-drama', 'horror']) expect(ids).not.toContain(banned);
    expect(ranked[0]!.reason).toMatch(/superação|Leve e para cima/);
    expect(ranked.find((r) => r.id === 'dramedy')!.reason).toMatch(/sem romance no centro/);
  });

  it('"quero rir" puxa comédia', () => {
    const ranked = rankTitles(LIBRARY, { mode: 'mood', intent: interpretMood('quero rir muito hoje') }, ctx);
    expect(['slapstick', 'dramedy', 'romcom']).toContain(ranked[0]!.id);
  });

  it('duração máxima derruba o que é longo', () => {
    const lib = [item('long', ['comedy'], { runtimeMin: 170 }), item('short', ['comedy'], { runtimeMin: 90 })];
    const ranked = rankTitles(lib, { mode: 'mood', intent: interpretMood('quero rir, tenho 1h30') }, ctx);
    expect(ranked[0]!.id).toBe('short');
  });

  it('perfil de gosto desempata e aparece no motivo', () => {
    const lib = [item('a', ['comedy', 'drama']), item('b', ['comedy', 'drama'])];
    const taste = tasteFromSignals([
      { signal: 'watched', value: 1, genres: ['comedy'] },
      { signal: 'rated', value: 5, genres: ['comedy'] },
    ]);
    expect(taste.comedy).toBeGreaterThan(0.3);
    const ranked = rankTitles(
      [...lib, item('c', ['animation'])],
      { mode: 'surprise', genre: 'comedy' },
      { ...ctx, taste },
    );
    expect(ranked[0]!.reason).toMatch(/você curte comédia/);
  });
});

describe('tasteFromSignals', () => {
  it('nota baixa e abandono puxam para baixo', () => {
    const t = tasteFromSignals([
      { signal: 'rated', value: 1, genres: ['horror'] },
      { signal: 'dropped', value: 1, genres: ['horror'] },
    ]);
    expect(t.horror).toBeLessThan(0);
  });
});

describe('pickContinue', () => {
  const at = (h: number) => new Date(2026, 8, 28, h);

  it('pega a lista em andamento mais recente e o próximo na ordem da lista', () => {
    const res = pickContinue([
      {
        id: 'old',
        pinned: false,
        lastActivity: at(8),
        items: [
          { id: 'o1', status: 'watched', position: 0 },
          { id: 'o2', status: 'to_watch', position: 1 },
        ],
      },
      {
        id: 'marathon',
        pinned: false,
        lastActivity: at(20),
        items: [
          { id: 'm3', status: 'to_watch', position: 2 },
          { id: 'm1', status: 'watched', position: 0 },
          { id: 'm2', status: 'watched', position: 1 },
          { id: 'm4', status: 'to_watch', position: 3 },
        ],
      },
    ]);
    expect(res).toEqual({ listId: 'marathon', nextId: 'm3', done: 2, total: 4, available: false });
  });

  it('item em andamento vem antes do próximo "para ver"; fixada vence a mais recente', () => {
    const res = pickContinue([
      {
        id: 'recent',
        pinned: false,
        lastActivity: at(22),
        items: [
          { id: 'r1', status: 'watched', position: 0 },
          { id: 'r2', status: 'to_watch', position: 1 },
        ],
      },
      {
        id: 'pinned',
        pinned: true,
        lastActivity: at(1),
        items: [
          { id: 'p1', status: 'to_watch', position: 0 },
          { id: 'p2', status: 'watching', position: 1 },
        ],
      },
    ]);
    expect(res).toMatchObject({ listId: 'pinned', nextId: 'p2', done: 0 });
  });

  it('lista não começada ou já concluída não entra', () => {
    expect(
      pickContinue([
        { id: 'fresh', pinned: false, lastActivity: at(1), items: [{ id: 'a', status: 'to_watch', position: 0 }] },
        { id: 'done', pinned: false, lastActivity: at(2), items: [{ id: 'b', status: 'watched', position: 0 }] },
      ]),
    ).toBeNull();
  });
});

describe('listNameFromOcr', () => {
  const now = new Date('2026-09-28T15:00:00Z');
  it('usa a linha de cabeçalho antes do primeiro item, sem emoji e sem ruído', () => {
    const text = ['9:41', 'cinefilo.br', 'Seguir', '12 filmes que você PRECISA ver 🍿:', '1. Oppenheimer (2023)', '2. Duna (2021)'].join('\n');
    expect(listNameFromOcr(text, ['Oppenheimer', 'Duna'], now)).toBe('12 filmes que você PRECISA ver');
  });

  it('sem cabeçalho → "Prints de <data>"', () => {
    expect(listNameFromOcr('1. Oppenheimer\n2. Duna', ['Oppenheimer', 'Duna'], now)).toBe('Prints de 28/09/2026');
  });
});
