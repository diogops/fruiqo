import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Armazenamento de tokens em memória no lugar do Keychain/Keystore.
const mockStore = new Map<string, string>();
jest.mock('../tokenStore', () => ({
  getToken: async (k: string) => mockStore.get(k) ?? null,
  setToken: async (k: string, v: string) => void mockStore.set(k, v),
  deleteToken: async (k: string) => void mockStore.delete(k),
}));

// eslint-disable-next-line import/first
import * as api from '../client';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
function mockFetch(responder: (url: string) => { status: number; body?: unknown }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = responder(url);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof fetch;
}

const pair = { accessToken: 'acc', refreshToken: 'x'.repeat(40), expiresIn: 900 };

beforeEach(() => {
  mockStore.clear();
  calls.length = 0;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('deleteAccount', () => {
  it('manda senha + EXCLUIR e apaga os tokens no sucesso', async () => {
    mockFetch((url) => (url.endsWith('/auth/login') ? { status: 200, body: pair } : { status: 204 }));
    await api.login({ email: 'eu@example.com', password: 'senha-bem-longa', deviceName: 't' });
    expect(await api.hasStoredSession()).toBe(true);

    await api.deleteAccount('senha-bem-longa');
    const call = calls.find((c) => c.url.endsWith('/account'))!;
    expect(call.init.method).toBe('DELETE');
    expect(JSON.parse(String(call.init.body))).toEqual({ password: 'senha-bem-longa', confirm: 'EXCLUIR' });
    expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer acc');
    expect(await api.hasStoredSession()).toBe(false);
  });

  it('senha errada (401) lança erro e mantém a sessão', async () => {
    mockFetch((url) =>
      url.endsWith('/auth/login')
        ? { status: 200, body: pair }
        : { status: 401, body: { error: 'unauthorized', message: 'Senha incorreta' } },
    );
    await api.login({ email: 'eu@example.com', password: 'senha-bem-longa', deviceName: 't' });
    await expect(api.deleteAccount('errada')).rejects.toMatchObject({ status: 401 });
    expect(await api.hasStoredSession()).toBe(true);
  });
});
