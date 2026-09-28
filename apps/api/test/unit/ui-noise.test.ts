import { describe, expect, it } from 'vitest';
import { isUiNoise, stripUiNoise } from '../../src/pipeline/ui-noise.js';

describe('ruído de UI', () => {
  it.each([
    '9:41',
    '10:02 PM',
    '87%',
    'Curtido por joao.silva e outras 1.234 pessoas',
    'Liked by maria and 20 others',
    'Ver todos os 87 comentários',
    'View all 12 comments',
    'Ver tradução',
    'Seguir',
    'Responder',
    'Mais',
    'há 2 dias',
    '3 weeks ago',
    '2 d',
    '5 sem',
    '1.234 curtidas',
    '12 mil visualizações',
    '3,4k likes',
    '1.234',
    'Áudio original',
    'Original audio · filmesdasemana',
    'Sugestões para você',
    'Patrocinado',
    '@filmesdasemana',
    'joao.silva',
    'filmes_da_semana • Seguir',
    '❤️ 💬 ✈️',
    '—',
  ])('filtra "%s"', (line) => {
    expect(isUiNoise(line)).toBe(true);
  });

  it.each(['1917', 'Oppenheimer (2023)', 'Toy Story 3', '1. Duna', 'Cidade de Deus', 'Top 10 filmes', '300'])(
    'mantém "%s"',
    (line) => {
      expect(isUiNoise(line)).toBe(false);
    },
  );

  it('remove as linhas de ruído de um texto', () => {
    expect(stripUiNoise('9:41\n1. Duna\nCurtido por ana\n2. Bacurau\nhá 2 dias')).toBe('1. Duna\n2. Bacurau');
  });
});
