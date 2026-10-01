// Primeiro acesso: com o perfil vazio (o servidor decide), o app abre o Perfil uma vez, com as
// boas-vindas; "Pronto" ou "Agora não" encerram de vez.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { Layout } from '../components/Layout';
import { mockApi, renderWithProviders } from '../test/helpers';
import { Profile } from './Profile';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ email: 'novo@fruiqo.test', signOut: vi.fn() }),
}));

afterEach(() => __setAccessToken(null));

const settings = (onboarding: boolean) => ({
  rememberMood: false,
  aiConsent: false,
  aiConsentAt: null,
  aiAvailable: true,
  aiUnavailableReason: null,
  moodRetentionDays: 90,
  onboarding,
});

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route path="hoje" element={<p>página de hoje</p>} />
        <Route path="perfil" element={<Profile />} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('primeiro acesso', () => {
  it('perfil vazio: abre o Perfil com as boas-vindas; "Agora não" encerra e não volta', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /profile/settings': settings(true),
      'PATCH /profile/settings': settings(false),
    });
    const user = userEvent.setup();
    renderApp('/hoje');
    expect(await screen.findByRole('heading', { name: /Boas-vindas ao Fruiqo/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Marque os streamings que você assina' }).getAttribute('href')).toBe('#assinaturas');
    await user.click(screen.getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/profile/settings')?.body).toEqual({ onboarded: true }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Boas-vindas/ })).toBeNull());
  });

  it('quem já tem perfil fica onde está', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /profile/settings': settings(false) });
    renderApp('/hoje');
    expect(await screen.findByText('página de hoje')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('página de hoje')).toBeTruthy();
  });

  it('"Pronto, quero sugestões" encerra e leva ao "O que assistir hoje?"', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /profile/settings': settings(true), 'PATCH /profile/settings': settings(false) });
    const user = userEvent.setup();
    renderApp('/perfil');
    await user.click(await screen.findByRole('button', { name: 'Pronto, quero sugestões' }));
    expect(await screen.findByText('página de hoje')).toBeTruthy();
  });
});
