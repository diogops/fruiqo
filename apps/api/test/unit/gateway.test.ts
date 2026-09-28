import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { GatewayError, PipelineGateway, redactUrl, requestKey } from '../../src/pipeline/gateway.js';
import { safeFetchJson } from '../../src/pipeline/safe-fetch.js';

function recordingsDir(recs: Record<string, unknown>[]) {
  const dir = mkdtempSync(join(tmpdir(), 'fruiqo-rec-'));
  mkdirSync(join(dir, 'fx', 'recordings'), { recursive: true });
  recs.forEach((r, i) => writeFileSync(join(dir, 'fx', 'recordings', `r${i}.json`), JSON.stringify(r)));
  return dir;
}

const rec = (url: string, body: unknown, extra: Record<string, unknown> = {}) => ({
  synthetic: true,
  recorded_at: '2026-01-01T00:00:00.000Z',
  request: { method: 'GET', url },
  response: { status: 200, contentType: 'application/json', body },
  ...extra,
});

const never = vi.fn(async () => {
  throw new Error('rede não pode ser usada no mock');
}) as unknown as typeof fetch;

describe('PipelineGateway (RF-20)', () => {
  it('chave ignora credenciais e ordem dos parâmetros', () => {
    expect(redactUrl('https://api.themoviedb.org/3/x?b=2&api_key=SEGREDO&a=1')).toBe('https://api.themoviedb.org/3/x?a=1&b=2');
    expect(requestKey('GET', 'https://api.themoviedb.org/3/x?a=1&api_key=k1')).toBe(
      requestKey('get', 'https://api.themoviedb.org/3/x?api_key=k2&a=1'),
    );
  });

  it('mock responde pela gravação passando pelo safeFetch e nunca usa a rede', async () => {
    const dir = recordingsDir([rec('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fx', { title: 'T' })]);
    const gw = new PipelineGateway({ mode: 'mock', recordingDirs: [dir], realFetch: never });
    const out = await safeFetchJson('https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2Fx&format=json', { fetchImpl: gw.fetchImpl });
    expect(out).toEqual({ title: 'T' });
    expect(never).not.toHaveBeenCalled();
  });

  it('mock sem gravação lança GatewayError (e continua sem rede)', async () => {
    const gw = new PipelineGateway({ mode: 'mock', recordingDirs: [], realFetch: never });
    await expect(gw.fetchImpl('https://api.spotify.com/v1/search?q=a')).rejects.toBeInstanceOf(GatewayError);
    expect(never).not.toHaveBeenCalled();
  });

  it('recusa gravação real vencida (TMDB 180 dias, YouTube 30 dias); sintética não vence', async () => {
    const dir = recordingsDir([
      rec('https://api.themoviedb.org/3/old', {}, { synthetic: false, recorded_at: '2026-01-01T00:00:00.000Z' }),
      rec('https://www.youtube.com/oembed?url=u', {}, { synthetic: false, recorded_at: '2026-08-01T00:00:00.000Z' }),
      rec('https://api.themoviedb.org/3/fresh', { ok: 1 }, { synthetic: false, recorded_at: '2026-09-01T00:00:00.000Z' }),
      rec('https://api.themoviedb.org/3/synthetic', { ok: 2 }, { synthetic: true, recorded_at: '2020-01-01T00:00:00.000Z' }),
    ]);
    const gw = new PipelineGateway({ mode: 'mock', recordingDirs: [dir], now: () => new Date('2026-09-28T00:00:00Z') });
    await expect(gw.fetchImpl('https://api.themoviedb.org/3/old')).rejects.toThrow(/vencida \(180/);
    await expect(gw.fetchImpl('https://www.youtube.com/oembed?url=u')).rejects.toThrow(/vencida \(30/);
    expect(await (await gw.fetchImpl('https://api.themoviedb.org/3/fresh')).json()).toEqual({ ok: 1 });
    expect(await (await gw.fetchImpl('https://api.themoviedb.org/3/synthetic')).json()).toEqual({ ok: 2 });
  });

  it('record grava só no diretório privado, por fixture, sem credencial', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fruiqo-private-'));
    const realFetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } }));
    const gw = new PipelineGateway({ mode: 'record', recordDir: out, realFetch: realFetch as unknown as typeof fetch });
    await gw.runWithFixture('minha-fixture', () =>
      gw.fetchImpl('https://api.themoviedb.org/3/search/multi?query=x&api_key=SEGREDO', {
        headers: { authorization: 'Bearer OUTRO-SEGREDO' },
      }),
    );
    const dir = join(out, 'minha-fixture', 'recordings');
    const [file] = readdirSync(dir);
    const content = readFileSync(join(dir, file!), 'utf8');
    expect(content).not.toContain('SEGREDO');
    expect(JSON.parse(content)).toMatchObject({ synthetic: false, request: { url: 'https://api.themoviedb.org/3/search/multi?query=x' } });
  });

  it('LLM no mock responde pela gravação, sem cliente real', async () => {
    const params = { model: 'm', system: 's', messages: [{ role: 'user', content: 'c' }] };
    const key = requestKey('LLM', 'llm://anthropic/m', JSON.stringify([params.system, params.messages]));
    expect(key).toHaveLength(64);
    const dir = recordingsDir([
      {
        synthetic: true,
        recorded_at: '2026-01-01T00:00:00.000Z',
        request: { method: 'LLM', url: 'llm://anthropic/m', body: JSON.stringify([params.system, params.messages]) },
        response: { status: 200, body: { parsed_output: { items: [] }, stop_reason: 'end_turn' } },
      },
    ]);
    const real = vi.fn();
    const client = new PipelineGateway({ mode: 'mock', recordingDirs: [dir] }).llmClient(real);
    expect(await client.messages.parse(params)).toEqual({ parsed_output: { items: [] }, stop_reason: 'end_turn' });
    expect(real).not.toHaveBeenCalled();
  });

  it('ações externas são simuladas fora do live (RF-23)', async () => {
    const gw = new PipelineGateway({ mode: 'mock', recordingDirs: [] });
    const a = await gw.performAction({ kind: 'spotify_add_to_playlist', target: 'spotify:playlist:x', payload: { track: 't' } });
    expect(a).toMatchObject({ simulated: true, mode: 'mock', kind: 'spotify_add_to_playlist' });
    expect(gw.simulatedActions).toHaveLength(1);
    await expect(new PipelineGateway({ mode: 'live' }).performAction({ kind: 'deep_link_open', target: 'x' })).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('env (RF-20 fail-closed)', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    REDIS_URL: 'redis://x',
    JWT_SECRET: 'x'.repeat(40),
  };
  it('produção só aceita live e sandbox desligado', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', PIPELINE_MODE: 'mock' })).toThrow(/PIPELINE_MODE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', PIPELINE_MODE: 'record' })).toThrow(/PIPELINE_MODE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SANDBOX_ENABLED: 'true' })).toThrow(/SANDBOX_ENABLED/);
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).PIPELINE_MODE).toBe('live');
  });
  it('descartar não pode ter limiar maior que revisar', () => {
    expect(() => loadEnv({ ...base, REVIEW_THRESHOLD: '0.3', DISCARD_THRESHOLD: '0.4' })).toThrow(/DISCARD_THRESHOLD/);
  });
});
