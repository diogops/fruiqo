import { describe, expect, it } from '@jest/globals';
import { rankLabel } from '../labels';

describe('rankLabel (fila de prioridade)', () => {
  it('mostra a posição, com o total quando conhecido', () => {
    expect(rankLabel(1)).toBe('#1');
    expect(rankLabel(3, 42)).toBe('#3 de 42');
  });
  it('itens da fila de revisão não têm posição', () => {
    expect(rankLabel(null)).toBe('Fora da fila (em revisão)');
  });
});
