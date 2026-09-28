import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/helpers';
import { __setAccessToken, api, login, onSessionLost, refreshSession } from './client';

const TAXONOMY = { version: 1, genres: [{ key: 'comedy', label: 'Comédia' }], subgenres: [] };

afterEach(() => {
  __setAccessToken(null);
  onSessionLost(null);
});

describe('cliente web (RF-30)', () => {
  it('login guarda o access token em memória e manda cabeçalho web + cookies', async () => {
    const { calls } = mockApi({
      'POST /auth/login': { accessToken: 'tok-1', expiresIn: 900 },
      'GET /taxonomy/genres': TAXONOMY,
    });
    await login('dev@fruiqo.test', 'x'.repeat(12));
    await api.taxonomy();
    expect(calls[0].headers['X-Fruiqo-Client']).toBe('web');
    expect(calls[0].credentials).toBe('include');
    expect(calls[0].body).toMatchObject({ email: 'dev@fruiqo.test', deviceName: 'Navegador (web)' });
    expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('em 401 renova pelo cookie uma única vez e repete a chamada', async () => {
    __setAccessToken('velho');
    let taxonomyCalls = 0;
    const { calls } = mockApi({
      'GET /taxonomy/genres': (c) => {
        taxonomyCalls += 1;
        return c.headers.Authorization === 'Bearer novo' ? { body: TAXONOMY } : { status: 401, body: { error: 'unauthorized', message: 'x' } };
      },
      'POST /auth/refresh': { accessToken: 'novo', expiresIn: 900 },
    });
    const [a, b] = await Promise.all([api.taxonomy(), api.taxonomy()]);
    expect(a.genres[0].label).toBe('Comédia');
    expect(b.version).toBe(1);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(calls.find((c) => c.path === '/auth/refresh')?.body).toBeUndefined();
    expect(taxonomyCalls).toBe(4);
  });

  it('refresh negado derruba a sessão', async () => {
    __setAccessToken('velho');
    const lost = vi.fn();
    onSessionLost(lost);
    mockApi({
      'GET /taxonomy/genres': () => ({ status: 401, body: { error: 'unauthorized', message: 'x' } }),
      'POST /auth/refresh': () => ({ status: 401, body: { error: 'unauthorized', message: 'x' } }),
    });
    await expect(api.taxonomy()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledOnce();
    expect(await refreshSession()).toBe(false);
  });

  it('valida a resposta com o contrato (formato inesperado vira erro)', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /taxonomy/genres': { version: 'um' } });
    await expect(api.taxonomy()).rejects.toThrow();
  });
});
