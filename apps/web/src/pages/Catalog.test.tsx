import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Catalog } from './Catalog';

afterEach(() => __setAccessToken(null));

describe('catálogo (RF-24/25)', () => {
  it('filtros vão para a API e a ação em massa pode ser desfeita', async () => {
    __setAccessToken('tok');
    const items = [makeTitle({ title: 'Oppenheimer' }), makeTitle({ title: 'Aftersun' })];
    const { calls } = mockApi({
      'GET /taxonomy/genres': { version: 1, genres: [{ key: 'drama', label: 'Drama' }], subgenres: [] },
      'GET /lists': [],
      'GET /library': { items, nextCursor: null },
      'POST /library/bulk': {
        affected: 2,
        undoToken: '11111111-1111-4111-8111-111111111111',
        undoExpiresAt: '2026-09-28T12:00:00.000Z',
      },
      'POST /library/bulk/undo': { restored: 2 },
    });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />, { route: '/catalogo?status=to_watch' });
    await screen.findByText('Oppenheimer');

    // o filtro da URL vira query string da API (nenhum filtro é feito no front)
    expect(calls.some((c) => c.path.startsWith('/library?') && c.path.includes('status=to_watch'))).toBe(true);

    await user.click(screen.getByLabelText('Selecionar todos'));
    const bar = screen.getByRole('region', { name: 'Ações em massa' });
    expect(within(bar).getByText('2 selecionado(s)')).toBeTruthy();
    await user.selectOptions(within(bar).getByLabelText('Definir prioridade'), '3');

    await waitFor(() => expect(calls.some((c) => c.path === '/library/bulk')).toBe(true));
    const bulk = calls.find((c) => c.path === '/library/bulk');
    expect(bulk?.body).toEqual({ titleIds: items.map((t) => t.id), operation: { type: 'set_priority', priority: 3 } });

    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/library/bulk/undo')?.body).toEqual({
        undoToken: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await screen.findByText('Desfeito (2 título(s)).');
  });
});
