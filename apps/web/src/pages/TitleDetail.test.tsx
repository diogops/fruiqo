import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Catalog } from './Catalog';

afterEach(() => __setAccessToken(null));

describe('detalhe do título', () => {
  it('nota de meia em meia estrela, logos que abrem o serviço e edição avançada recolhida', async () => {
    __setAccessToken('tok');
    const t = makeTitle({
      title: 'Chernobyl',
      kind: 'series',
      rank: 1,
      overview: 'A história da explosão na usina.',
      watchUrl: 'https://www.themoviedb.org/tv/87108/watch?locale=BR',
      watchProvidersBR: [
        { name: 'Max', type: 'flatrate', logoUrl: 'https://image.tmdb.org/t/p/w92/max.png' },
        { name: 'Serviço Novo', type: 'flatrate', logoUrl: 'https://image.tmdb.org/t/p/w92/novo.png' },
      ],
    });
    const { calls } = mockApi({
      'GET /taxonomy/genres': { version: 1, genres: [], subgenres: [] },
      'GET /lists': [],
      'GET /library': { items: [t], nextCursor: null },
      'GET /library/:id': t,
      'PATCH /library/:id': () => ({ body: { ...t, rating: 4.5 } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />, { route: '/catalogo' });
    await user.click((await screen.findAllByRole('button', { name: 'Chernobyl' }))[0]!);
    const dialog = await screen.findByRole('dialog');

    // TOS-REQ-38: crédito à JustWatch junto do onde assistir; o texto do TMDB fica nos Créditos
    expect(await within(dialog).findByText('via JustWatch')).toBeTruthy();
    expect(within(dialog).queryByText(/not endorsed/)).toBeNull();
    // serviço conhecido abre o site dele; desconhecido cai na página do TMDB
    expect(within(dialog).getByRole('link', { name: 'Abrir Max' }).getAttribute('href')).toBe('https://www.max.com/br/pt');
    expect(within(dialog).getByRole('link', { name: 'Abrir Serviço Novo' }).getAttribute('href')).toBe(t.watchUrl);

    // o resto fica em "Edição avançada", fechado por padrão
    const advanced = within(dialog).getByText('Edição avançada').closest('details')!;
    expect(advanced.open).toBe(false);
    // atualizar dados é só um ícone com tooltip
    expect(within(dialog).getByRole('button', { name: 'Buscar no TMDB' }).getAttribute('title')).toBe('Buscar no TMDB');

    const stars = within(dialog).getByRole('slider', { name: 'Sua nota para Chernobyl' });
    stars.focus();
    await user.keyboard('{End}');
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ rating: 5 }));
  });
});
