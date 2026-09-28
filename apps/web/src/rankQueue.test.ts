import { describe, expect, it } from 'vitest';
import { shiftRanks, targetPosition } from './rankQueue';

const q = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, rank: i + 1 }));
const order = (m: Map<string, number>) => [...m.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

describe('fila de prioridade (otimista)', () => {
  it('sobe para o topo deslocando o intervalo para baixo', () => {
    expect(order(shiftRanks(q(5), 't4', 4, 1))).toEqual(['t4', 't1', 't2', 't3', 't5']);
  });
  it('desce para uma posição deslocando o intervalo para cima', () => {
    expect(order(shiftRanks(q(5), 't1', 1, 3))).toEqual(['t2', 't3', 't1', 't4', 't5']);
  });
  it('mantém 1..N contínuo', () => {
    const ranks = [...shiftRanks(q(6), 't2', 2, 6).values()].sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('targetPosition limita ao tamanho da fila', () => {
    expect(targetPosition(3, 10, { to: 'up' })).toBe(2);
    expect(targetPosition(10, 10, { to: 'down' })).toBe(10);
    expect(targetPosition(2, 10, { position: 42 })).toBe(10);
  });
});
