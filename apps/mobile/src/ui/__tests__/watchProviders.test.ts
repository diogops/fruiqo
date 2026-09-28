import { describe, expect, it } from '@jest/globals';

import { groupProviders } from '../components';

describe('groupProviders', () => {
  it('agrupa por tipo na ordem assinatura → aluguel → compra e remove variantes repetidas', () => {
    const groups = groupProviders([
      { name: 'Apple TV', type: 'rent' },
      { name: 'Netflix', type: 'flatrate', key: 'netflix' },
      { name: 'Netflix Standard with Ads', type: 'flatrate', key: 'netflix' },
      { name: 'Globoplay', type: 'flatrate', key: 'globoplay' },
    ]);
    expect(groups.map(([t, l]) => [t, l.map((p) => p.name)])).toEqual([
      ['flatrate', ['Netflix', 'Globoplay']],
      ['rent', ['Apple TV']],
    ]);
  });
});
