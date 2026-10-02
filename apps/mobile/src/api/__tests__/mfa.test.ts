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

const calls: { url: string; init: RequestInit }[] = [];
function mockFetch(responder: (url: string, body: Record<string, unknown>) => { status: number; body?: unknown }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = responder(url, init.body ? JSON.parse(String(init.body)) : {});
    return new Response(JSON.stringify(body ?? {}), { status });
  }) as unknown as typeof fetch;
}

const pair = { accessToken: 'acc', refreshToken: 'x'.repeat(40), expiresIn: 900 };
const challenge = { mfaRequired: true, mfaToken: 'desafio-de-mfa-com-mais-de-vinte' };

beforeEach(() => {
  mockStore.clear();
  calls.length = 0;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('login com MFA (app)', () => {
  it('senha certa com MFA: devolve o desafio sem guardar sessão; o código certo abre a sessão', async () => {
    mockFetch((url, body) => {
      if (url.endsWith('/auth/login')) return { status: 200, body: challenge };
      return body.code === '123456' ? { status: 200, body: { ...pair, email: 'eu@example.com' } } : { status: 401, body: { error: 'Unauthorized', message: 'Código inválido' } };
    });
    expect(await api.login({ email: 'eu@example.com', password: 'senha-bem-longa', deviceName: 't' })).toEqual({ mfaToken: challenge.mfaToken });
    expect(await api.hasStoredSession()).toBe(false);

    await expect(api.completeMfa(challenge.mfaToken, '000000')).rejects.toMatchObject({ status: 401 });
    expect(await api.hasStoredSession()).toBe(false);

    await api.completeMfa(challenge.mfaToken, ' 123456 ');
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ mfaToken: challenge.mfaToken, code: '123456' });
    expect(await api.hasStoredSession()).toBe(true);
  });

  it('sem MFA: entra direto, como antes', async () => {
    mockFetch(() => ({ status: 200, body: pair }));
    expect(await api.login({ email: 'eu@example.com', password: 'senha-bem-longa', deviceName: 't' })).toBeNull();
    expect(await api.hasStoredSession()).toBe(true);
  });
});
