import { describe, expect, it } from 'vitest';
import { interpretBrowseQuery } from '../../src/library/browse-query.js';

describe('D-23: buscas de exploração (leitura local, sem LLM)', () => {
  it('"melhor série da Netflix"', () => {
    expect(interpretBrowseQuery('melhor serie da Netflix')).toMatchObject({ best: true, kind: 'series', services: ['netflix'], miniseries: false });
  });

  it('"melhor miniserie de suspense da netflix"', () => {
    const b = interpretBrowseQuery('melhor miniserie de suspense da netflix')!;
    expect(b).toMatchObject({ best: true, kind: 'series', miniseries: true, services: ['netflix'], genres: ['thriller'] });
    expect(b.person).toBeUndefined();
  });

  it('"melhor curta metragem da Apple TV"', () => {
    expect(interpretBrowseQuery('melhor curta metragem da Apple TV')).toMatchObject({ best: true, short: true, kind: 'movie', services: ['apple'] });
  });

  it('"melhor serie de scifi"', () => {
    expect(interpretBrowseQuery('melhor serie de scifi')).toMatchObject({ best: true, kind: 'series', genres: ['scifi'], services: [] });
  });

  it('"melhor filme do keanu reeves na hbo": sobra o nome da pessoa', () => {
    expect(interpretBrowseQuery('melhor filme do keanu reeves na hbo')).toMatchObject({ best: true, kind: 'movie', services: ['max'], person: 'keanu reeves' });
  });

  it('"melhor filme de super herói": palavra-chave do TMDB', () => {
    const b = interpretBrowseQuery('melhor filme de super herói')!;
    expect(b).toMatchObject({ best: true, kind: 'movie', keywordIds: [9715] });
    expect(b.person).toBeUndefined();
  });

  it('lançamentos e em breve', () => {
    expect(interpretBrowseQuery('lançamentos de terror')).toMatchObject({ releases: 'recent', genres: ['horror'], best: false });
    expect(interpretBrowseQuery('filmes em breve')).toMatchObject({ releases: 'upcoming', kind: 'movie' });
    expect(interpretBrowseQuery('estreias da netflix')).toMatchObject({ releases: 'recent', services: ['netflix'] });
  });

  it('título comum não vira exploração ("Top Gun", "Mad Max", "Duna", "terror anos 80")', () => {
    expect(interpretBrowseQuery('Top Gun')).toBeNull();
    expect(interpretBrowseQuery('Mad Max')).toBeNull();
    expect(interpretBrowseQuery('Duna')).toBeNull();
    expect(interpretBrowseQuery('terror anos 80')).toBeNull();
  });
});
