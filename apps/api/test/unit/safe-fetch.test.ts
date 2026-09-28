import { describe, expect, it, vi } from 'vitest';
import { safeFetchJson, SafeFetchError } from '../../src/pipeline/safe-fetch.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('safeFetchJson (SEC-REQ-01)', () => {
  it('busca JSON de host permitido e não segue redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'ok' }));
    await expect(safeFetchJson('https://www.youtube.com/oembed?url=x', { fetchImpl })).resolves.toEqual({ title: 'ok' });
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe('manual');
  });

  it.each([
    'https://evil.example.com/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://www.youtube.com.evil.example/x',
    'http://www.youtube.com/oembed',
    'https://www.youtube.com:8443/oembed',
    'https://u:p@www.youtube.com/oembed',
    'nota url',
  ])('recusa %s sem fazer a requisição', async (url) => {
    const fetchImpl = vi.fn();
    await expect(safeFetchJson(url, { fetchImpl })).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recusa redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }));
    await expect(safeFetchJson('https://www.youtube.com/oembed', { fetchImpl })).rejects.toThrow(/redirect/);
  });

  it('recusa resposta que não é JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await expect(safeFetchJson('https://www.youtube.com/oembed', { fetchImpl })).rejects.toThrow(/JSON/);
  });

  it('recusa content-length acima do limite', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } }),
    );
    await expect(safeFetchJson('https://www.youtube.com/oembed', { fetchImpl, maxBytes: 1024 })).rejects.toThrow(/grande/);
  });

  it('corta stream que passa do limite mesmo sem content-length', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(5000) });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Blob([big]).stream(), { headers: { 'content-type': 'application/json' } }),
    );
    await expect(safeFetchJson('https://www.youtube.com/oembed', { fetchImpl, maxBytes: 1024 })).rejects.toThrow(/grande/);
  });

  it('propaga status de erro', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    await expect(safeFetchJson('https://www.youtube.com/oembed', { fetchImpl })).rejects.toMatchObject({ status: 404 });
  });
});
