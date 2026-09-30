import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { setUserSettings } from './settings-helpers.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { FIXTURES_DIR, PipelineGateway } from '../../src/pipeline/gateway.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { buildProcessor } from '../../src/worker-runtime.js';
import { APP_URL, testEnv } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let sandbox: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp();
  sandbox = await startTestApp({ SANDBOX_ENABLED: 'true' });
});
afterAll(async () => {
  await ctx.app.close();
  await sandbox.app.close();
  await pool.end();
});

type App = typeof ctx;

async function share(app: App, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const user = await register(app.http);
  const req = app.http().post('/shares').set('authorization', `Bearer ${user.accessToken}`);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  const res = await req.send({ clientShareId: randomUUID(), ...body }).expect(201);
  const userId = user.refreshToken.split('.')[0]!;
  // SEC-CTRL-51: estes testes exercitam o extrator por LLM, que exige consentimento do usuário
  await setUserSettings(db, userId, { aiConsent: true });
  return { user, shareId: res.body.id as string, userId };
}

async function steps(app: App, token: string, id: string) {
  return (await app.http().get(`/shares/${id}/steps`).set('authorization', `Bearer ${token}`).expect(200)).body;
}

function processor(llmItems?: { kind: 'movie'; title: string; confidence: number }[]) {
  return new ShareProcessor({
    db,
    logger: pino({ level: 'silent' }),
    heuristic: new HeuristicExtractor(),
    ...(llmItems ? { llm: { name: 'llm' as const, extract: async () => llmItems } } : {}),
    fetchMetadata: async () => ({ title: 'Artista Teste - Canção Teste (Official Video)', author: 'Artista Teste' }),
    resolvers: [],
  });
}

describe('pipeline inspector (RF-19)', () => {
  it('share de link: etapas em ordem, sem trecho de texto de terceiro fora de fixture', async () => {
    const { user, shareId, userId } = await share(ctx, { text: 'https://youtube.com/watch?v=abc123&si=x' });
    await processor().process({ shareId, userId });
    const body = await steps(ctx, user.accessToken, shareId);
    expect(body.isFixture).toBe(false);
    expect(body.steps.map((s: { step: string }) => s.step)).toEqual(['normalize', 'metadata', 'extract', 'dedup', 'resolve', 'decide']);
    expect(body.steps.map((s: { seq: number }) => s.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    const metadata = body.steps[1];
    expect(metadata.outputSummary).toEqual({ found: true, hasAuthor: true });
    expect(JSON.stringify(body.steps)).not.toContain('Official Video');
    expect(body.decisions).toEqual([
      // decisão do pipeline (inspector/eval); o título em si entra direto na Minha Área (D-23)
      expect.objectContaining({
        rawTitle: 'Canção Teste',
        kind: 'music_track',
        decision: 'review_queue',
        reason: 'suggested_cataloged:confident',
        recommendationId: expect.any(String),
      }),
    ]);
  });

  it('share de prints: ocr_input, merge_pages e noise_filter entram no log', async () => {
    const { user, shareId, userId } = await share(ctx, { pages: ['Seguir\n1. Bacurau (2019)\n2. Aquarius (2016)\nCurtido por fulano e outras 10 pessoas'] });
    await processor().process({ shareId, userId });
    const body = await steps(ctx, user.accessToken, shareId);
    expect(body.steps.map((s: { step: string }) => s.step)).toEqual([
      'ocr_input',
      'merge_pages',
      'noise_filter',
      'extract',
      'dedup',
      'resolve',
      'decide',
    ]);
    const noise = body.steps.find((s: { step: string }) => s.step === 'noise_filter');
    expect(noise.outputSummary).toMatchObject({ noiseLines: 2 });
    expect(noise.outputSummary).not.toHaveProperty('previews');
  });

  it('decisão por candidato: revisão e descarte (só catalogado/revisão viram recomendação)', async () => {
    const { user, shareId, userId } = await share(ctx, { text: 'lista qualquer' });
    await processor([
      { kind: 'movie', title: 'Alta Confiança', confidence: 0.9 },
      { kind: 'movie', title: 'Média Confiança', confidence: 0.3 },
      { kind: 'movie', title: 'Quase Nada', confidence: 0.05 },
    ]).process({ shareId, userId });
    const got = (await ctx.http().get(`/shares/${shareId}`).set('authorization', `Bearer ${user.accessToken}`).expect(200)).body;
    expect(
      got.recommendations.map((r: { title: string; decision: string; suggestedDecision: string }) => [r.title, r.decision, r.suggestedDecision]),
    ).toEqual([
      // D-23: sem revisão, tudo entra catalogado (Quero assistir); a sugestão do pipeline fica guardada
      ['Alta Confiança', 'cataloged', 'cataloged'],
      ['Média Confiança', 'cataloged', 'review_queue'],
    ]);
    const body = await steps(ctx, user.accessToken, shareId);
    expect(body.decisions.find((d: { rawTitle: string }) => d.rawTitle === 'Quase Nada')).toMatchObject({ decision: 'discarded' });
    expect(body.decisions.find((d: { rawTitle: string }) => d.rawTitle === 'Quase Nada')).not.toHaveProperty('recommendationId');
  });

  it('cabeçalho X-Fruiqo-Fixture marca fixture só com o sandbox ligado; fixture guarda os trechos', async () => {
    const off = await share(ctx, { text: 'x' }, { 'x-fruiqo-fixture': 'minha-fixture' });
    expect((await steps(ctx, off.user.accessToken, off.shareId)).isFixture).toBe(false);

    const on = await share(sandbox, { text: 'https://youtube.com/watch?v=abc' }, { 'x-fruiqo-fixture': 'minha-fixture' });
    await processor().process({ shareId: on.shareId, userId: on.userId });
    const body = await steps(sandbox, on.user.accessToken, on.shareId);
    expect(body.isFixture).toBe(true);
    expect(body.steps[1].outputSummary.preview).toContain('Official Video');

    const bad = await share(sandbox, { text: 'x' }, { 'x-fruiqo-fixture': '../../etc' });
    expect((await steps(sandbox, bad.user.accessToken, bad.shareId)).isFixture).toBe(false);
  });

  it('RLS: outro usuário não vê as etapas (nem pela API nem por SQL direto)', async () => {
    const a = await share(ctx, { text: 'https://youtube.com/watch?v=rls' });
    await processor().process({ shareId: a.shareId, userId: a.userId });
    const b = await register(ctx.http);
    await ctx.http().get(`/shares/${a.shareId}/steps`).set('authorization', `Bearer ${b.accessToken}`).expect(404);
    const bId = b.refreshToken.split('.')[0]!;
    const rows = await withUser(db, bId, (tx) =>
      tx.execute(sql`select count(*)::int as n from pipeline_step_logs where share_id = ${a.shareId}`),
    );
    expect(rows.rows[0]).toEqual({ n: 0 });
    const decisions = await withUser(db, bId, (tx) =>
      tx.execute(sql`select count(*)::int as n from candidate_decisions where share_id = ${a.shareId}`),
    );
    expect(decisions.rows[0]).toEqual({ n: 0 });
  });
});

describe('PIPELINE_MODE=mock (RF-20)', () => {
  it('processa a fixture url-youtube com a rede bloqueada', async () => {
    const blocked = vi.fn(async () => {
      throw new Error('rede bloqueada');
    });
    const original = globalThis.fetch;
    globalThis.fetch = blocked as unknown as typeof fetch;
    try {
      const env = testEnv({ PIPELINE_MODE: 'mock' });
      const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: [FIXTURES_DIR] });
      const p = buildProcessor(env, pino({ level: 'silent' }), db, undefined as never, gateway);
      const { user, shareId, userId } = await share(ctx, { url: 'https://youtube.com/watch?v=FIXTURE0001&si=rastreio123' });
      await p.process({ shareId, userId });
      const got = (await ctx.http().get(`/shares/${shareId}`).set('authorization', `Bearer ${user.accessToken}`).expect(200)).body;
      expect(got).toMatchObject({
        status: 'done',
        source: { platform: 'youtube', url: 'https://youtube.com/watch?v=FIXTURE0001', title: expect.stringContaining('Canção de Teste') },
        recommendations: [{ title: 'Canção de Teste', creator: 'Banda Fictícia', kind: 'music_track' }],
      });
      const body = await steps(ctx, user.accessToken, shareId);
      expect(body.steps.every((s: { mode: string }) => s.mode === 'mock')).toBe(true);
      expect(blocked).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
