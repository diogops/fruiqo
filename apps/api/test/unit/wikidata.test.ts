import { providerTitleLink } from '@fruiqo/contracts';
import { describe, expect, it } from 'vitest';
import { buildQuery, fetchTitleLinks, linksFromBindings } from '../../src/pipeline/resolvers/wikidata.js';

const row = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));

describe('D-22: links diretos pelo Wikidata', () => {
  it('consulta pelo ID do TMDB certo para filme e série, só com o número', () => {
    expect(buildQuery('movie', 872585)).toContain('wdt:P4947 "872585"');
    expect(buildQuery('tv', 87108)).toContain('wdt:P4983 "87108"');
    expect(buildQuery('tv', 87108)).toContain('P7596'); // Disney+ série
    expect(buildQuery('movie', 1.9)).toContain('"1"');
  });

  it('monta a página pública do título em cada serviço', () => {
    const links = linksFromBindings('tv', {
      results: {
        bindings: [
          row({ P1874: '81104911', P8298: 'series/urn:hbo:series:GXJvkMAU0JIG6gAEAAAIo', P9751: 'umc.cmc.4r07f208iugn79go4pmvpcqbt', P7596: '3jLIGMDYINqD' }),
        ],
      },
    });
    expect(links).toEqual({
      netflix: 'https://www.netflix.com/br/title/81104911',
      max: 'https://play.hbomax.com/series/urn:hbo:series:GXJvkMAU0JIG6gAEAAAIo',
      apple_tv: 'https://tv.apple.com/br/show/umc.cmc.4r07f208iugn79go4pmvpcqbt',
      disney_plus: 'https://www.disneyplus.com/pt-br/series/wp/3jLIGMDYINqD',
    });
  });

  it('ID fora do formato esperado é ignorado (nada de caminho ou host vindo do Wikidata)', () => {
    const links = linksFromBindings('movie', {
      results: { bindings: [row({ P1874: '123/../../evil', P7299: 'https://evil.example', P8298: '../x', P9586: 'umc.cmc.abcdefghijk' })] },
    });
    expect(links).toEqual({ apple_tv: 'https://tv.apple.com/br/movie/umc.cmc.abcdefghijk' });
    expect(linksFromBindings('movie', { nada: true })).toEqual({});
  });

  it('falha de rede não quebra: sai sem links', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    await expect(fetchTitleLinks('movie', 1, failing as never)).resolves.toEqual({});
  });

  it('prioridade do link: título direto → busca com o nome → página inicial', () => {
    expect(providerTitleLink('Netflix', 'Chernobyl', { netflix: 'https://www.netflix.com/br/title/81104911' })).toEqual({
      url: 'https://www.netflix.com/br/title/81104911',
      kind: 'title',
    });
    expect(providerTitleLink('HBO Max', 'Chernobyl', {})).toEqual({ url: 'https://play.hbomax.com/search?q=Chernobyl', kind: 'search' });
    expect(providerTitleLink('Paramount Plus', 'Halo')).toEqual({ url: 'https://www.paramountplus.com/br/', kind: 'home' });
    expect(providerTitleLink('Serviço Novo', 'X')).toBeUndefined();
  });
});
