// A política de privacidade é pública: abre sem login (exigência do login com Google e da LGPD).
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { mockApi } from '../test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('política de privacidade', () => {
  it('abre sem login e traz responsável, contato, IA e exclusão da conta', async () => {
    mockApi({ 'POST /auth/refresh': () => ({ status: 401, body: { error: 'unauthorized', message: 'x' } }) });
    window.history.pushState({}, '', '/privacidade');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Política de privacidade' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'diogops@gmail.com' })[0]!.getAttribute('href')).toBe('mailto:diogops@gmail.com');
    expect(screen.getByText(/OpenAI, só se você permitir a IA/)).toBeTruthy();
    expect(screen.getByText(/Login com Google/)).toBeTruthy();
  });

  it('sem sessão, as outras rotas continuam pedindo login', async () => {
    mockApi({ 'POST /auth/refresh': () => ({ status: 401, body: { error: 'unauthorized', message: 'x' } }) });
    window.history.pushState({}, '', '/hoje');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'política de privacidade' }).getAttribute('href')).toBe('/privacidade');
  });
});
