import { describe, expect, it } from 'vitest';
import { interpretSearchQuery } from '../../src/library/search-query.js';

describe('leitura local da busca (sem IA)', () => {
  it('"recente/lançamento" + gênero vira filtro de gênero dos últimos anos', () => {
    expect(interpretSearchQuery('Filme recente de faroeste')).toMatchObject({ type: 'genre', genres: ['western'], kind: 'movie', recent: true });
    expect(interpretSearchQuery('lançamentos de terror')).toMatchObject({ type: 'genre', genres: ['horror'], recent: true });
    // década explícita vence a recência
    expect(interpretSearchQuery('terror anos 80').recent).toBeUndefined();
  });

  it('título com palavra parecida não vira filtro', () => {
    expect(interpretSearchQuery('Os Novos Mutantes').type).toBe('title');
    expect(interpretSearchQuery('Duna 2021')).toMatchObject({ type: 'title', text: 'Duna', year: 2021 });
  });
});
