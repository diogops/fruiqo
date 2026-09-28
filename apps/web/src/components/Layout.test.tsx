import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockViewport, renderWithProviders } from '../test/helpers';
import { Layout } from './Layout';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ email: 'dev@fruiqo.test', signOut: vi.fn() }),
}));

function renderShell(route = '/catalogo') {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route path="catalogo" element={<p>página do catálogo</p>} />
        <Route path="listas" element={<p>página das listas</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('layout responsivo', () => {
  it('no celular a navegação fica num drawer: abre pelo hambúrguer, prende o foco e fecha com Esc', async () => {
    mockViewport(375);
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // fechado: fora da árvore acessível
    expect(screen.queryByRole('link', { name: 'Listas' })).toBeNull();

    await user.click(toggle);
    const drawer = screen.getByRole('dialog', { name: 'Menu principal' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const firstLink = within(drawer).getByRole('link', { name: 'Catálogo' });
    expect(document.activeElement).toBe(firstLink);

    // Tab e Shift+Tab não escapam do drawer (foco preso)
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 12; i++) await user.tab();
    expect(drawer.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Menu principal' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('navegar pelo drawer fecha o menu', async () => {
    mockViewport(768);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Menu principal' })).getByRole('link', { name: 'Listas' }));
    expect(await screen.findByText('página das listas')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Menu principal' })).toBeNull();
  });

  it('no desktop a sidebar fica fixa, sem hambúrguer, e pode ser recolhida', async () => {
    mockViewport(1440);
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole('button', { name: 'Abrir menu' })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Seções' });
    expect(within(nav).getByRole('link', { name: 'Listas' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Recolher menu' }));
    expect(screen.getByRole('button', { name: 'Expandir menu' }).getAttribute('aria-pressed')).toBe('true');
    // recolhida, o rótulo continua acessível (só fica visualmente oculto)
    expect(within(nav).getByRole('link', { name: 'Listas' })).toBeTruthy();
  });

  it('no celular estreito a busca global vira botão e expande', async () => {
    mockViewport(375);
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole('searchbox', { name: 'Buscar no catálogo' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const box = screen.getByRole('searchbox', { name: 'Buscar no catálogo' });
    expect(document.activeElement).toBe(box);
    await user.click(screen.getByRole('button', { name: 'Fechar busca' }));
    expect(screen.queryByRole('searchbox', { name: 'Buscar no catálogo' })).toBeNull();
  });
});
