import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { mockApi, renderWithProviders } from '../test/helpers';
import { DeleteAccountSection } from './DeleteAccount';

function Probe() {
  const { state } = useAuth();
  if (state === 'checking') return <p>carregando</p>;
  return state === 'signed_in' ? <DeleteAccountSection /> : <p>saiu</p>;
}

function setup(routes: Parameters<typeof mockApi>[0]) {
  // sessão ativa pelo cookie
  const api = mockApi({ 'POST /auth/refresh': { accessToken: 'tok', expiresIn: 900 }, ...routes });
  renderWithProviders(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return api;
}

afterEach(() => vi.unstubAllGlobals());

async function openAndFill(password: string, confirm: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Excluir minha conta' }));
  await userEvent.type(screen.getByLabelText('Sua senha atual'), password);
  await userEvent.type(screen.getByLabelText(/para confirmar/), confirm);
}

describe('Excluir minha conta', () => {
  it('só habilita com a senha e EXCLUIR digitado, e ao excluir volta para fora', async () => {
    const { calls } = setup({ 'DELETE /account': () => ({ status: 204 }) });
    await openAndFill('minha-senha-longa', 'excluir');
    expect((screen.getByRole('button', { name: 'Excluir definitivamente' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/para confirmar/));
    await userEvent.type(screen.getByLabelText(/para confirmar/), 'EXCLUIR');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir definitivamente' }));
    await waitFor(() => expect(screen.getByText('saiu')).toBeTruthy());
    const call = calls.find((c) => c.path === '/account')!;
    expect(call.method).toBe('DELETE');
    expect(call.body).toEqual({ password: 'minha-senha-longa', confirm: 'EXCLUIR' });
    expect(call.headers['X-Fruiqo-Client']).toBe('web');
  });

  it('senha errada mostra erro e mantém a sessão', async () => {
    setup({ 'DELETE /account': () => ({ status: 401, body: { error: 'unauthorized', message: 'Senha incorreta' } }) });
    await openAndFill('senha-errada', 'EXCLUIR');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir definitivamente' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Senha incorreta/));
    expect(screen.queryByText('saiu')).toBeNull();
  });
});
