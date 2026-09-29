import { describe, expect, it } from '@jest/globals';
import { providerSiteUrl } from '@fruiqo/contracts';

import { nextRating, ratingText } from '../components';

describe('nota em estrelas (meia em meia)', () => {
  it('tocar na mesma estrela alterna cheia → meia → sem nota', () => {
    expect(nextRating(null, 4)).toBe(4);
    expect(nextRating(4, 4)).toBe(3.5);
    expect(nextRating(3.5, 4)).toBeNull();
    expect(nextRating(2, 4)).toBe(4);
    expect(nextRating(undefined, 1)).toBe(1);
    expect(nextRating(1, 1)).toBe(0.5);
  });

  it('texto com meia estrela', () => {
    expect(ratingText(3.5)).toBe('★★★½');
    expect(ratingText(5)).toBe('★★★★★');
    expect(ratingText(0.5)).toBe('½');
  });
});

describe('site do serviço (D-22)', () => {
  it('conhecidos vão para o site; desconhecido fica sem URL', () => {
    expect(providerSiteUrl('Netflix Standard with Ads')).toBe('https://www.netflix.com/br/');
    expect(providerSiteUrl('Amazon Prime Video')).toBe('https://www.primevideo.com/');
    expect(providerSiteUrl('HBO Max')).toBe('https://www.hbomax.com/br/pt');
    expect(providerSiteUrl('Maxplus Qualquer')).toBeUndefined();
    expect(providerSiteUrl('Serviço Novo')).toBeUndefined();
  });
});
