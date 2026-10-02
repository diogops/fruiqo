// Página pública do link "Esqueci minha senha": senha nova com confirmação; link inválido explica.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderWithProviders } from '../test/helpers';
import { ResetPassword } from './ResetPassword';

afterEach(() => vi.unstubAllGlobals());

const render = (route: string) =>
  renderWithProviders(
    <Routes>
      <Route path="/redefinir-senha" element={<ResetPassword />} />
    </Routes>,
    { route },
  );

describe('redefinir senha', () => {
  it('troca a senha com o token do link', async () => {
    const { calls } = mockApi({ 'POST /auth/password/reset': { status: 204 } });
    render('/redefinir-senha?token=tok-do-link');
    await userEvent.type(screen.getByLabelText('Senha nova'), 'senha-nova-bem-longa');
    await userEvent.type(screen.getByLabelText('Confirmar senha nova'), 'senha-nova-bem-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText(/Sua senha foi trocada/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/password/reset')?.body).toEqual({ token: 'tok-do-link', password: 'senha-nova-bem-longa' });
  });

  it('confere a confirmação e explica link expirado', async () => {
    mockApi({ 'POST /auth/password/reset': () => ({ status: 401, body: { error: 'Unauthorized', message: 'Link inválido' } }) });
    render('/redefinir-senha?token=velho');
    await userEvent.type(screen.getByLabelText('Senha nova'), 'senha-nova-bem-longa');
    await userEvent.type(screen.getByLabelText('Confirmar senha nova'), 'outra-senha-bem-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(screen.getByText('As senhas não conferem.')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Confirmar senha nova'));
    await userEvent.type(screen.getByLabelText('Confirmar senha nova'), 'senha-nova-bem-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText(/inválido ou já expirou/)).toBeTruthy();
  });
});
