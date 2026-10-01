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
    const firstLink = within(drawer).getByRole('link', { name: 'Assistir hoje' });
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

describe('dica de instalação no iPhone', () => {
  const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  it('só no Safari do iPhone/iPad e fora do modo instalado', async () => {
    const { shouldShowInstallTip } = await import('./Layout');
    expect(shouldShowInstallTip({ userAgent: IPHONE_SAFARI }, false)).toBe(true);
    expect(shouldShowInstallTip({ userAgent: IPHONE_SAFARI, standalone: true }, false)).toBe(false);
    expect(shouldShowInstallTip({ userAgent: IPHONE_SAFARI }, true)).toBe(false);
    expect(shouldShowInstallTip({ userAgent: IPHONE_SAFARI.replace('Version/18.0', 'CriOS/129.0') }, false)).toBe(false);
    // iPad em modo desktop se apresenta como Mac com toque
    expect(shouldShowInstallTip({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }, false)).toBe(true);
    expect(shouldShowInstallTip({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129 Safari/537.36' }, false)).toBe(false);
  });
});
