// RF-42/43/44: encaixe na fila (declarado + sinais + notas + posição) com explicação em pt-BR.
import { interpretTasteStatement } from '@fruiqo/taxonomy';
import { describe, expect, it } from 'vitest';
import {
  declaredAffinity,
  draftOrder,
  type FitContext,
  fitScore,
  notesByGenre,
  positionReason,
  type QueueEntry,
  suggestPosition,
} from '../../src/library/fit.js';
import { interpretSearchQuery } from '../../src/library/search-query.js';
import { PerUserRateLimiter } from '../../src/library/search.service.js';

function ctx(partial: Partial<FitContext> = {}): FitContext {
  return {
    declared: new Map(),
    likedSubgenres: new Set(),
    dislikedSubgenres: new Set(),
    signals: {},
    notes: new Map(),
    favorites: [],
    ...partial,
  };
}

describe('declaredAffinity', () => {
  it('favoritos somam pelos gêneros (nota pesa); "não gosto" do resumo vence', () => {
    const aff = declaredAffinity(
      [
        { title: 'Fav A', genres: ['crime', 'drama'], rating: 5 },
        { title: 'Fav B', genres: ['crime'], rating: null },
        { title: 'Fav C', genres: ['horror'], rating: 4 },
      ],
      interpretTasteStatement('Adoro séries de crime e documentários. Não gosto de terror.'),
    );
    expect(aff.get('crime')).toMatchObject({ source: 'both' });
    expect(aff.get('crime')!.score).toBeGreaterThan(0.8);
    expect(aff.get('documentary')).toEqual({ score: 0.8, source: 'summary' });
    expect(aff.get('drama')!.source).toBe('favorites');
    expect(aff.get('horror')).toEqual({ score: -0.9, source: 'both' });
  });
});

describe('fitScore', () => {
  it('declarado + sinais + notas, com as razões em pt-BR', () => {
    const c = ctx({
      declared: declaredAffinity([], interpretTasteStatement('gosto de crime')),
      signals: { drama: 0.6 },
      notes: notesByGenre([
        { genres: ['crime'], rating: 5 },
        { genres: ['crime', 'drama'], rating: 4 },
      ]),
    });
    const fit = fitScore({ title: 'X', genres: ['crime', 'drama'] }, c);
    expect(fit.basis).toBe(true);
    expect(fit.score).toBeGreaterThan(0.3);
    expect(fit.reasons).toContain('Você declarou gostar de Crime');
    expect(fit.reasons.some((r) => r.startsWith('Combina com o que você tem assistido (Drama)'))).toBe(true);
    expect(fit.reasons.some((r) => r.startsWith('Suas notas para Crime'))).toBe(true);
  });

  it('gênero rejeitado derruba o score e explica', () => {
    const c = ctx({ declared: declaredAffinity([], interpretTasteStatement('odeio terror')) });
    const fit = fitScore({ title: 'Susto', genres: ['horror'] }, c);
    expect(fit.score).toBeLessThan(0);
    expect(fit.reasons[0]).toBe('Você disse que não curte Terror');
  });

  it('"parecido com <favorito>" e o próprio favorito', () => {
    const favorites = [{ title: 'Série Favorita', genres: ['crime', 'drama', 'mystery'], rating: 5, tmdbId: 10, mediaType: 'tv' as const }];
    const c = ctx({ favorites, declared: declaredAffinity(favorites, null) });
    const similar = fitScore({ title: 'Outra', genres: ['crime', 'drama'] }, c);
    expect(similar.reasons).toContain('Parecido com Série Favorita, um dos seus favoritos');
    const same = fitScore({ title: 'Série Favorita', genres: [], tmdbId: 10, mediaType: 'tv' }, c);
    expect(same).toEqual({ score: 1, reasons: ['Está entre os seus favoritos (Série Favorita)'], basis: true });
  });

  it('sem gêneros: sem base (vai para o fim)', () => {
    const fit = fitScore({ title: 'Y', genres: [] }, ctx());
    expect(fit.basis).toBe(false);
    expect(suggestPosition(fit, [{ id: 'a', title: 'A', rank: 1, status: 'to_watch', score: -1 }])).toEqual({ position: 2, total: 2 });
  });
});

describe('suggestPosition', () => {
  const queue: QueueEntry[] = [
    { id: 'a', title: 'A', rank: 1, status: 'watching', score: -0.5 },
    { id: 'b', title: 'B', rank: 2, status: 'to_watch', score: 0.6 },
    { id: 'c', title: 'C', rank: 3, status: 'watched', score: -0.9 },
    { id: 'd', title: 'D', rank: 4, status: 'to_watch', score: 0.1 },
  ];

  it('entra antes do primeiro aberto que encaixa claramente pior (visto não conta)', () => {
    const p = suggestPosition({ score: 0.3, basis: true }, queue);
    expect(p).toEqual({ position: 1, total: 5, before: { id: 'a', title: 'A', rank: 1 } });
    const q = suggestPosition({ score: 0.3, basis: true }, queue.slice(1));
    expect(q.position).toBe(4);
    expect(positionReason(q)).toBe('Entra em #4, antes de D');
  });

  it('pior que todos: fim da fila', () => {
    const p = suggestPosition({ score: -0.8, basis: true }, queue);
    expect(p).toEqual({ position: 5, total: 5 });
    expect(positionReason(p)).toBe('Entra no fim da fila (#5)');
    expect(positionReason(suggestPosition({ score: 0, basis: true }, []))).toBe('Primeiro título da sua fila');
  });
});

describe('draftOrder (RF-44)', () => {
  const fit = (score: number, reason = 'r') => ({ score, reasons: [reason], basis: true });
  const items = [
    { id: 'w', rank: 3, status: 'watching' as const, fit: fit(-0.2) },
    { id: 'low', rank: 1, status: 'to_watch' as const, fit: fit(-0.6, 'ruim') },
    { id: 'done', rank: 2, status: 'watched' as const, fit: fit(0.9) },
    { id: 'high', rank: 4, status: 'to_watch' as const, fit: fit(0.8, 'bom') },
  ];

  it('to_watch: assistindo no topo, "para ver" por encaixe, vistos no fim', () => {
    const order = draftOrder(items);
    expect(order.map((o) => o.id)).toEqual(['w', 'high', 'low', 'done']);
    expect(order[1]!.reason).toBe('bom');
    expect(order[3]!.reason).toBe('Já assistido: vai para o fim');
  });

  it('all: assistindo entra na ordenação (com bônus)', () => {
    expect(draftOrder(items, 'all').map((o) => o.id)).toEqual(['high', 'w', 'low', 'done']);
  });

  it('empate de encaixe mantém a ordem atual (peso da posição)', () => {
    const same = [
      { id: 'x', rank: 1, status: 'to_watch' as const, fit: fit(0) },
      { id: 'y', rank: 2, status: 'to_watch' as const, fit: fit(0) },
    ];
    expect(draftOrder(same).map((o) => o.id)).toEqual(['x', 'y']);
  });
});

describe('interpretSearchQuery (RF-46)', () => {
  it('título com ano no fim', () => {
    expect(interpretSearchQuery('Duna 2021')).toMatchObject({ type: 'title', text: 'Duna', year: 2021 });
    expect(interpretSearchQuery('Monstro (2022)')).toMatchObject({ type: 'title', text: 'Monstro', year: 2022 });
    expect(interpretSearchQuery('2012')).toMatchObject({ type: 'title', text: '2012' });
  });

  it('nome próprio fica como título (a pessoa é reconhecida pelo TMDB)', () => {
    expect(interpretSearchQuery('Wagner Moura')).toMatchObject({ type: 'title', text: 'Wagner Moura', maybeDescription: false });
  });

  it('só gênero/tipo/década = busca por gênero', () => {
    expect(interpretSearchQuery('terror anos 80')).toMatchObject({ type: 'genre', genres: ['horror'], decade: 1980 });
    expect(interpretSearchQuery('filmes de suspense')).toMatchObject({ type: 'genre', genres: ['thriller'], kind: 'movie' });
    expect(interpretSearchQuery('comédia romântica').genres.sort()).toEqual(['comedy', 'romance']);
    expect(interpretSearchQuery('séries dos anos 2000')).toMatchObject({ type: 'genre', decade: 2000, kind: 'series' });
  });

  it('título que contém palavra de gênero continua título', () => {
    expect(interpretSearchQuery('Amor e Luto')).toMatchObject({ type: 'title', text: 'Amor e Luto' });
  });

  it('texto longo sem ano pode ser descrição', () => {
    const i = interpretSearchQuery('aquele filme do cara que acorda sempre no mesmo dia');
    expect(i).toMatchObject({ type: 'title', maybeDescription: true });
    expect(i.keywords.length).toBeGreaterThan(0);
  });
});

it('limite por usuário (RF-46)', () => {
  let now = 0;
  const limiter = new PerUserRateLimiter(2, 1000, () => now);
  expect([limiter.take('u'), limiter.take('u'), limiter.take('u'), limiter.take('v')]).toEqual([true, true, false, true]);
  now = 1001;
  expect(limiter.take('u')).toBe(true);
});
