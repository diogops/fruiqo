// Administração de acessos: pedidos (aprovar/recusar), autorizados (revogar) e o aviso quando falta MFA.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, renderWithProviders } from '../test/helpers';
import { Admin } from './Admin';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
afterEach(() => __setAccessToken(null));

const list = {
  configured: ['diogops@gmail.com'],
  entries: [
    { email: 'novo@ex.com', status: 'pending', requestedAt: '2026-10-02T10:00:00.000Z', decidedAt: null, hasAccount: false },
    { email: 'amigo@ex.com', status: 'approved', requestedAt: '2026-10-01T10:00:00.000Z', decidedAt: '2026-10-01T11:00:00.000Z', hasAccount: true },
  ],
};

describe('Administração', () => {
  it('aprova pedido, revoga autorizado e autoriza e-mail novo', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({ 'GET /admin/access': list, 'PUT /admin/access': { status: 204 } });
    const user = userEvent.setup();
    renderWithProviders(<Admin />);
    const pedidos = await screen.findByRole('list', { name: 'Pedidos de acesso' });
    await user.click(within(pedidos).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')[0]?.body).toEqual({ email: 'novo@ex.com', status: 'approved' }));
    const autorizados = screen.getByRole('list', { name: 'Autorizados' });
    expect(within(autorizados).getByText('diogops@gmail.com')).toBeTruthy();
    await user.click(within(autorizados).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ email: 'amigo@ex.com', status: 'denied' }));
    await user.type(screen.getByLabelText('Autorizar e-mail'), 'Outro@Ex.com');
    await user.click(screen.getByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')[2]?.body).toEqual({ email: 'outro@ex.com', status: 'approved' }));
  });

  it('sem MFA ligado: manda ativar no Perfil', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /admin/access': () => ({ status: 403, body: { error: 'Forbidden', message: 'Ative', code: 'mfa_setup_required' } }) });
    renderWithProviders(<Admin />);
    expect((await screen.findByRole('link', { name: 'Ativar no Perfil' })).getAttribute('href')).toBe('/perfil#mfa');
  });
});
