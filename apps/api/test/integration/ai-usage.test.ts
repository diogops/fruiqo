// Uso de IA no banco (ai_usage): grava por usuário sob RLS e resume em GET /profile/ai-usage.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAiUsageSink, trackingClient, withAiUsage } from '../../src/ai-usage/usage.js';
import { dbAiUsageSink } from '../../src/ai-usage/usage-store.js';
import { createDb, withUser } from '../../src/db/client.js';
import { aiUsage } from '../../src/db/schema.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';
import { APP_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  setAiUsageSink(null);
  await ctx.app.close();
  await pool.end();
});

const client = (inTok: number, outTok: number) =>
  trackingClient({ messages: { parse: async () => ({ usage: { input_tokens: inTok, output_tokens: outTok } }) } } as unknown as LlmClient);

describe('uso de IA (ai_usage)', () => {
  it('grava por usuário e recurso; resumo dos 30 dias por recurso e por dia; outro usuário não vê', async () => {
    const a = await register(ctx.http);
    const b = await register(ctx.http);
    const userA = a.refreshToken.split('.')[0]!;
    const userB = b.refreshToken.split('.')[0]!;
    setAiUsageSink(dbAiUsageSink(db));
    await withAiUsage(userA, 'tonight_plan', () => client(1000, 200).messages.parse({ model: 'claude-haiku-4-5', messages: [] }));
    await withAiUsage(userA, 'tonight_plan', () => client(1000, 200).messages.parse({ model: 'claude-haiku-4-5', messages: [] }));
    await withAiUsage(userA, 'tonight_titles', () => client(2000, 1000).messages.parse({ model: 'claude-opus-5-5', messages: [] }));
    await withAiUsage(userB, 'mood', () => client(500, 100).messages.parse({ model: 'claude-haiku-4-5', messages: [] }));
    await new Promise((r) => setTimeout(r, 200));

    const res = await ctx.http().get('/profile/ai-usage').set('authorization', `Bearer ${a.accessToken}`).expect(200);
    expect(res.body.total).toMatchObject({ calls: 3, failures: 0, inputTokens: 4000, outputTokens: 1400 });
    expect(res.body.total.costUsd).toBeCloseTo(2 * (1000 * 1 + 200 * 5) / 1e6 + (2000 * 4 + 1000 * 20) / 1e6);
    // do mais caro para o mais barato
    expect(res.body.features.map((f: { feature: string; calls: number }) => [f.feature, f.calls])).toEqual([
      ['tonight_titles', 1],
      ['tonight_plan', 2],
    ]);
    expect(res.body.days).toHaveLength(1);
    expect(res.body.days[0].calls).toBe(3);

    // RLS: B só vê o seu
    expect((await withUser(db, userB, (tx) => tx.select().from(aiUsage))).map((r) => r.feature)).toEqual(['mood']);
    const resB = await ctx.http().get('/profile/ai-usage').set('authorization', `Bearer ${b.accessToken}`).expect(200);
    expect(resB.body.total.calls).toBe(1);
  });
});
