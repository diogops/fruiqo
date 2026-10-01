import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { mockApi, renderWithProviders } from '../test/helpers';
import { Login, passwordStrength } from './Login';

const STRONG = 'Senha-Forte-2026!';

function Probe() {
  const { state } = useAuth();
  return state === 'signed_in' ? <p>logado</p> : <Login />;
}

function setup(routes: Parameters<typeof mockApi>[0]) {
  // sem sessão inicial: o refresh pelo cookie falha
  const api = mockApi({ 'POST /auth/refresh': () => ({ status: 401, body: { error: 'unauthorized', message: 'x' } }), ...routes });
  renderWithProviders(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return api;
}

afterEach(() => vi.unstubAllGlobals());

describe('Login: Entrar / Criar conta', () => {
  it('abre em Entrar com foco no e-mail e alterna para Criar conta', async () => {
    setup({});
    const email = await screen.findByLabelText('E-mail');
    expect(document.activeElement).toBe(email);
    expect(screen.queryByLabelText('Confirmar senha')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Criar conta' }));
    expect(screen.getByRole('heading', { name: 'Criar conta' })).toBeTruthy();
    expect(screen.getByLabelText('Confirmar senha')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('E-mail'));
  });

  it('valida senha curta e confirmação sem chamar a API', async () => {
    const { calls } = setup({});
    await userEvent.click(await screen.findByRole('tab', { name: 'Criar conta' }));
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'curta');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'curta');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.getByRole('alert').textContent).toMatch(/pelo menos 12/);

    await userEvent.clear(screen.getByLabelText('Senha'));
    await userEvent.type(screen.getByLabelText('Senha'), STRONG);
    await userEvent.clear(screen.getByLabelText('Confirmar senha'));
    await userEvent.type(screen.getByLabelText('Confirmar senha'), `${STRONG}x`);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(screen.getByRole('alert').textContent).toMatch(/não conferem/);
    expect(calls.some((c) => c.path === '/auth/register')).toBe(false);
  });

  it('cadastro com sucesso entra direto, pelo fluxo web', async () => {
    const { calls } = setup({ 'POST /auth/register': { accessToken: 'tok', expiresIn: 900 } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Criar conta' }));
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), STRONG);
    await userEvent.type(screen.getByLabelText('Confirmar senha'), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await waitFor(() => expect(screen.getByText('logado')).toBeTruthy());
    const call = calls.find((c) => c.path === '/auth/register')!;
    expect(call.headers['X-Fruiqo-Client']).toBe('web');
    expect(call.credentials).toBe('include');
    expect(call.body).toMatchObject({ email: 'eu@example.com', password: STRONG, deviceName: 'Navegador (web)' });
  });

  it.each([
    [403, /Não foi possível criar a conta com este e-mail/],
    [409, /Já existe uma conta com este e-mail/],
  ])('erro %i mostra mensagem clara e neutra', async (status, msg) => {
    setup({ 'POST /auth/register': () => ({ status, body: { error: 'x', message: 'E-mail não autorizado' } }) });
    await userEvent.click(await screen.findByRole('tab', { name: 'Criar conta' }));
    await userEvent.type(screen.getByLabelText('E-mail'), 'eu@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), STRONG);
    await userEvent.type(screen.getByLabelText('Confirmar senha'), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(msg));
    // nunca repete o texto do servidor que revela a allowlist
    expect(screen.getByRole('alert').textContent).not.toMatch(/não autorizado/);
  });
});

describe('passwordStrength', () => {
  it('classifica por comprimento e variedade', () => {
    expect(passwordStrength('abc').score).toBe(0);
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('aaaaaaaaaaa1').score).toBe(2);
    expect(passwordStrength(STRONG).score).toBe(3);
  });
});

describe('Login com Google', () => {
  afterEach(() => {
    delete (window as { google?: unknown }).google;
  });

  it('sem Client ID no servidor: sem botão do Google', async () => {
    setup({ 'GET /auth/providers': { google: null } });
    await screen.findByLabelText('E-mail');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('com Client ID: mostra o botão oficial; a credencial do Google vai para a API e entra', async () => {
    let callback: ((r: { credential?: string }) => void) | undefined;
    const rendered: Record<string, unknown>[] = [];
    (window as { google?: unknown }).google = {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (r: { credential?: string }) => void }) => {
            expect(cfg.client_id).toBe('cliente.apps.googleusercontent.com');
            callback = cfg.callback;
          },
          renderButton: (_el: HTMLElement, opts: Record<string, unknown>) => rendered.push(opts),
        },
      },
    };
    const { calls } = setup({
      'GET /auth/providers': { google: { clientId: 'cliente.apps.googleusercontent.com' } },
      'POST /auth/google': { accessToken: 'tok', expiresIn: 900, email: 'pessoa@gmail.com' },
    });
    expect(await screen.findByRole('separator')).toBeTruthy();
    await waitFor(() => expect(rendered[0]).toMatchObject({ text: 'continue_with', locale: 'pt-BR', shape: 'pill' }));
    callback!({ credential: 'id-token-do-google' });
    expect(await screen.findByText('logado')).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/google')?.body).toEqual({ credential: 'id-token-do-google', deviceName: 'Navegador (web)' });
  });

  it('e-mail sem acesso (403): explica', async () => {
    let callback: ((r: { credential?: string }) => void) | undefined;
    (window as { google?: unknown }).google = { accounts: { id: { initialize: (cfg: { callback: typeof callback }) => (callback = cfg.callback), renderButton: () => {} } } };
    setup({
      'GET /auth/providers': { google: { clientId: 'c' } },
      'POST /auth/google': () => ({ status: 403, body: { error: 'forbidden', message: 'E-mail não autorizado' } }),
    });
    await screen.findByRole('separator');
    await waitFor(() => expect(callback).toBeTruthy());
    callback!({ credential: 'x' });
    expect(await screen.findByText('Este e-mail ainda não tem acesso ao Fruiqo.')).toBeTruthy();
  });
});

