import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, mockViewport, renderWithProviders } from '../test/helpers';
import { Catalog } from './Catalog';

afterEach(() => {
  __setAccessToken(null);
  document.documentElement.classList.remove('has-docked-bulkbar');
});

function mockCatalog() {
  __setAccessToken('tok');
  const items = [makeTitle({ title: 'Oppenheimer', rank: 1 }), makeTitle({ title: 'Aftersun', rank: 2 })];
  return mockApi({
    'GET /taxonomy/genres': { version: 1, genres: [{ key: 'drama', label: 'Drama' }], subgenres: [] },
    'GET /lists': [],
    'GET /library': { items, nextCursor: null },
  });
}

describe('catálogo responsivo', () => {
  it('no celular vira lista de cards, com filtros num painel e ação em massa no rodapé', async () => {
    mockViewport(375);
    mockCatalog();
    const user = userEvent.setup();
    renderWithProviders(<Catalog />, { route: '/catalogo' });

    await screen.findByText('Oppenheimer');
    const list = screen.getByRole('list', { name: 'Títulos do catálogo' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(list).getByText('#1')).toBeTruthy();
    // controles da fila continuam no card
    expect(within(list).getByRole('button', { name: 'Descer Oppenheimer' })).toBeTruthy();

    // filtros saem da barra e vão para o painel
    expect(screen.queryByLabelText('Tipo')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Filtros/ }));
    const sheet = screen.getByRole('dialog', { name: 'Filtros' });
    await user.selectOptions(within(sheet).getByLabelText('Status'), 'to_watch');
    await user.click(within(sheet).getByRole('button', { name: 'Ver resultados' }));
    expect(screen.getByLabelText('1 filtro(s) ativo(s)')).toBeTruthy();

    // seleção múltipla → barra fixa no rodapé
    await user.click(screen.getByLabelText('Selecionar todos'));
    const bar = screen.getByRole('region', { name: 'Ações em massa' });
    expect(bar.className).toContain('bulkbar-docked');
    expect(document.documentElement.classList.contains('has-docked-bulkbar')).toBe(true);
    expect(within(bar).getByText('2 selecionado(s)')).toBeTruthy();
    // ações secundárias ficam recolhidas até pedir
    expect(within(bar).queryByRole('button', { name: 'Remover' })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Mais ações' }));
    expect(within(bar).getByRole('button', { name: 'Remover' })).toBeTruthy();
  });

  it('no desktop continua a tabela', async () => {
    mockViewport(1440);
    mockCatalog();
    renderWithProviders(<Catalog />, { route: '/catalogo' });
    await screen.findByText('Oppenheimer');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Oppenheimer')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Títulos do catálogo' })).toBeNull();
    expect(screen.getByLabelText('Tipo')).toBeTruthy();
  });
});
