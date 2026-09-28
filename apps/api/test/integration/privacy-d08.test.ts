import { randomUUID } from 'node:crypto';
import type { MoodIntent } from '@fruiqo/taxonomy';
import { interpretMood } from '@fruiqo/taxonomy';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendationRuns, userSettings } from '../../src/db/schema.js';
import { LibraryService } from '../../src/library/library.service.js';
import type { LlmSafeInput, MoodInterpreter } from '../../src/library/mood-interpreter.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { APP_URL, testEnv } from '../helpers.js';
import { register, startTestApp } from './app.js';
import { setUserSettings } from './settings-helpers.js';

const { db, pool } = createDb(APP_URL);
let ctx: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

async function newUser() {
  const u = await register(ctx.http);
  const userId = u.refreshToken.split('.')[0]!;
  const bearer = `Bearer ${u.accessToken}`;
  return {
    userId,
    get: (path: string) => ctx.http().get(path).set('authorization', bearer),
    patch: (path: string, body: object) => ctx.http().patch(path).set('authorization', bearer).send(body),
    post: (path: string, body: object) => ctx.http().post(path).set('authorization', bearer).send(body),
  };
}

function spyInterpreter() {
  const calls: LlmSafeInput[] = [];
  const interpreter: MoodInterpreter = {
    name: 'anthropic',
    interpret: async (input) => {
      calls.push(input);
      return { intent: interpretMood(input.userText) as MoodIntent, interpreter: 'anthropic', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001 };
    },
  };
  return { calls, interpreter };
}

async function moodRuns(userId: string) {
  return withUser(db, userId, (tx) => tx.select().from(recommendationRuns).where(eq(recommendationRuns.mode, 'mood')));
}

describe('preferências de privacidade (D-08)', () => {
  it('padrões: não lembra humor, sem consentimento de IA, IA indisponível', async () => {
    const me = await newUser();
    const res = (await me.get('/profile/settings').expect(200)).body;
    expect(res).toMatchObject({ rememberMood: false, aiConsent: false, aiConsentAt: null, aiAvailable: false, moodRetentionDays: 90 });
    expect(res.aiUnavailableReason).toBe('disabled');
  });

  it('PATCH grava e a data do consentimento só muda quando passa a true', async () => {
    const me = await newUser();
    const on = (await me.patch('/profile/settings', { aiConsent: true }).expect(200)).body;
    expect(on.aiConsent).toBe(true);
    expect(on.aiConsentAt).not.toBeNull();
    const again = (await me.patch('/profile/settings', { rememberMood: true }).expect(200)).body;
    expect(again.aiConsentAt).toBe(on.aiConsentAt);
    const off = (await me.patch('/profile/settings', { aiConsent: false }).expect(200)).body;
    expect(off.aiConsentAt).toBeNull();
    await me.patch('/profile/settings', {}).expect(400);
    await me.patch('/profile/settings', { rememberMood: 'sim' }).expect(400);
  });

  it('IA disponível só é informada com AI_MODE=anthropic e chave', async () => {
    const other = await startTestApp({ AI_MODE: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test-0000000000' });
    try {
      const u = await register(other.http);
      const res = (await other.http().get('/profile/settings').set('authorization', `Bearer ${u.accessToken}`).expect(200)).body;
      expect(res.aiAvailable).toBe(true);
      expect(res.aiUnavailableReason).toBeNull();
    } finally {
      await other.app.close();
    }
  });
});

describe('"lembrar meu humor" (SEC-CTRL-50)', () => {
  it('sem lembrar: o run guarda só o ranking, sem intenção, e não vira histórico', async () => {
    const me = await newUser();
    await me.post('/discover', { mode: 'mood', text: 'estou triste, sofrendo por amor' }).expect(200);
    const runs = await moodRuns(me.userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.intent).toBeNull();
    expect((await me.get('/profile/mood-history').expect(200)).body.items).toHaveLength(0);
  });

  it('com lembrar: guarda a intenção; desligar apaga as intenções já guardadas', async () => {
    const me = await newUser();
    await me.patch('/profile/settings', { rememberMood: true }).expect(200);
    await me.post('/discover', { mode: 'mood', text: 'estou triste, sofrendo por amor' }).expect(200);
    const hist = (await me.get('/profile/mood-history').expect(200)).body;
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0].need).toBe('uplifting');
    await me.patch('/profile/settings', { rememberMood: false }).expect(200);
    expect((await moodRuns(me.userId)).every((r) => r.intent === null)).toBe(true);
    expect((await me.get('/profile/mood-history').expect(200)).body.items).toHaveLength(0);
  });

  it('purga: lembrados saem em 90 dias; não lembrados em 1 dia', async () => {
    const me = await newUser();
    const day = 24 * 3600 * 1000;
    const base = { userId: me.userId, mode: 'mood' as const, aiMode: 'rules' as const, ranked: [] };
    await withUser(db, me.userId, (tx) =>
      tx.insert(recommendationRuns).values([
        { ...base, intent: { need: 'comfort' }, createdAt: new Date(Date.now() - 10 * day) },
        { ...base, intent: { need: 'comfort' }, createdAt: new Date(Date.now() - 91 * day) },
        { ...base, intent: null, createdAt: new Date(Date.now() - 2 * day) },
        { ...base, intent: null, createdAt: new Date() },
      ]),
    );
    await withUser(db, me.userId, (tx) => tx.execute(sql`select purge_expired_mood_runs()`));
    const left = await moodRuns(me.userId);
    expect(left).toHaveLength(2);
    expect(left.some((r) => r.intent === null)).toBe(true);
    expect(left.some((r) => (r.intent as { need?: string } | null)?.need === 'comfort')).toBe(true);
  });
});

describe('consentimento individual de IA (SEC-CTRL-51)', () => {
  it('AI_MODE=anthropic sem consentimento: usa regras e não chama o LLM', async () => {
    const me = await newUser();
    const { calls, interpreter } = spyInterpreter();
    const service = new LibraryService(db, testEnv({ AI_MODE: 'anthropic' }), interpreter);
    const res = await service.discover(me.userId, { mode: 'mood', text: 'quero algo leve' });
    expect(res.interpreter).toBe('rules');
    expect(calls).toHaveLength(0);
  });

  it('com consentimento: o LLM recebe só o texto do usuário', async () => {
    const me = await newUser();
    await setUserSettings(db, me.userId, { aiConsent: true });
    const { calls, interpreter } = spyInterpreter();
    const service = new LibraryService(db, testEnv({ AI_MODE: 'anthropic' }), interpreter);
    const res = await service.discover(me.userId, { mode: 'mood', text: 'quero algo leve' });
    expect(res.interpreter).toBe('anthropic');
    expect(calls).toEqual([{ userText: 'quero algo leve' }]);
  });

  it('extração por LLM no worker também exige consentimento', async () => {
    const u = await register(ctx.http);
    const userId = u.refreshToken.split('.')[0]!;
    const share = await ctx.http()
      .post('/shares')
      .set('authorization', `Bearer ${u.accessToken}`)
      .send({ clientShareId: randomUUID(), text: 'assistam Severance' })
      .expect(201);
    let llmCalls = 0;
    const processor = new ShareProcessor({
      db,
      logger: pino({ level: 'silent' }),
      heuristic: new HeuristicExtractor(),
      llm: { name: 'llm', extract: async () => { llmCalls += 1; return []; } },
      fetchMetadata: async () => null,
      resolvers: [],
    });
    await processor.process({ shareId: share.body.id, userId });
    expect(llmCalls).toBe(0);
  });
});

describe('RLS de user_settings', () => {
  it('um usuário não lê nem grava as preferências de outro', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    await setUserSettings(db, a.userId, { rememberMood: true });
    const seenByB = await withUser(db, b.userId, (tx) => tx.select().from(userSettings));
    expect(seenByB.every((r) => r.userId === b.userId)).toBe(true);
    // c ainda não tem linha: a recusa vem da policy (WITH CHECK), não de conflito de chave
    await expect(
      withUser(db, b.userId, (tx) => tx.insert(userSettings).values({ userId: c.userId, rememberMood: false })),
    ).rejects.toThrow();
  });
});
