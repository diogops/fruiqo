// Fase 2d (integração, PIPELINE_MODE=mock com gravações sintéticas de fixtures/): enriquecimento
// TMDB sob demanda e backfill, gêneros manuais preservados, disponibilidade (RF-38) no /discover e no
// "Continuar", e o detector de risco antes de qualquer LLM (RNF-07).
import type { MoodIntent } from '@fruiqo/taxonomy';
import { interpretMood } from '@fruiqo/taxonomy';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendationRuns, recommendations } from '../../src/db/schema.js';
import { createTitleLookup, EnrichmentService } from '../../src/library/enrichment.service.js';
import { LibraryService } from '../../src/library/library.service.js';
import type { LlmSafeInput, MoodInterpreter } from '../../src/library/mood-interpreter.js';
import { setUserSettings } from './settings-helpers.js';
import { APP_URL, testEnv } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp({ PIPELINE_MODE: 'mock' });
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

const userIdOf = (u: { refreshToken: string }) => u.refreshToken.split('.')[0]!;

async function newUser() {
  const u = await register(ctx.http);
  const auth = (req: ReturnType<ReturnType<typeof ctx.http>['get']>) => req.set('Authorization', `Bearer ${u.accessToken}`);
  const post = (path: string, body: unknown) => ctx.http().post(path).set('Authorization', `Bearer ${u.accessToken}`).send(body as object);
  const patch = (path: string, body: unknown) => ctx.http().patch(path).set('Authorization', `Bearer ${u.accessToken}`).send(body as object);
  const put = (path: string, body: unknown) => ctx.http().put(path).set('Authorization', `Bearer ${u.accessToken}`).send(body as object);
  const get = (path: string) => auth(ctx.http().get(path));
  const addTitle = async (title: string, year: number, extra: Record<string, unknown> = {}) =>
    (await post('/library', { title, kind: 'movie', year, ...extra }).expect(201)).body.id as string;
  return { u, userId: userIdOf(u), post, patch, put, get, addTitle };
}

describe('enriquecimento TMDB (mock)', () => {
  it('sob demanda: gêneros, sinopse, duração, IMDb e onde assistir no BR', async () => {
    const me = await newUser();
    const id = await me.addTitle('O Farol de Papel', 2021);
    const res = await me.post(`/library/${id}/enrich`, {}).expect(200);
    expect(res.body.status).toBe('enriched');
    const t = res.body.title;
    expect(t.enrichment).toBe('tmdb');
    expect(t.genres.map((g: { key: string }) => g.key).sort()).toEqual(['drama', 'romance']);
    expect(t.runtimeMin).toBe(104);
    expect(t.overview).toContain('fictícia');
    expect(t.watchUrl).toBe('https://www.themoviedb.org/movie/9900001/watch?locale=BR');
    expect(t.watchProvidersBR).toEqual(
      expect.arrayContaining([
        { name: 'Netflix', type: 'flatrate', key: 'netflix' },
        { name: 'Locadora Fictícia', type: 'rent' },
      ]),
    );
    expect(t.resolution.imdbId).toBe('tt9900001');
    const [row] = await withUser(db, me.userId, (tx) => tx.select().from(recommendations).where(eq(recommendations.id, id)));
    expect(row!.resolvedAt).not.toBeNull(); // TTL de 180 dias parte daqui (TOS-REQ-02)
  });

  it('sem gravação no mock = indisponível (não é "sem correspondência"); título de música não se aplica', async () => {
    const me = await newUser();
    const id = await me.addTitle('Filme Que Não Existe Nas Gravações', 2001);
    expect((await me.post(`/library/${id}/enrich`, {}).expect(200)).body.status).toBe('unavailable');
    const song = (await me.post('/library', { title: 'Canção', kind: 'music_track', creator: 'Alguém' }).expect(201)).body.id;
    expect((await me.post(`/library/${song}/enrich`, {}).expect(200)).body.status).toBe('unsupported');
  });

  it('gêneros marcados à mão não são sobrescritos', async () => {
    const me = await newUser();
    const id = await me.addTitle('Noites de Vidro', 2019);
    await me.patch(`/library/${id}`, { genres: ['thriller'] }).expect(200);
    const t = (await me.post(`/library/${id}/enrich`, {}).expect(200)).body.title;
    expect(t.enrichment).toBe('manual');
    expect(t.genres.map((g: { key: string }) => g.key)).toEqual(['thriller']);
    expect(t.runtimeMin).toBe(97);
    expect(t.watchProvidersBR[0].key).toBe('globoplay');
  });

  it('backfill: enriquece os `none`, conta os indisponíveis e respeita `demo` sem a flag', async () => {
    const me = await newUser();
    await me.addTitle('O Farol de Papel', 2021);
    await me.addTitle('Noites de Vidro', 2019);
    await me.addTitle('Sem Gravação', 2010);
    const service = new EnrichmentService(db, createTitleLookup(testEnv({ PIPELINE_MODE: 'mock' })));
    const seen: string[] = [];
    const report = await service.backfill(me.userId, { concurrency: 2, delayMs: 0, onResult: (t, s) => seen.push(`${t}:${s}`) });
    expect(report).toEqual({ candidates: 3, enriched: 2, noMatch: 0, unavailable: 1, errors: 0 });
    expect(seen).toContain('Sem Gravação:unavailable');
    // já enriquecidos não voltam a ser candidatos
    expect((await service.backfill(me.userId, { delayMs: 0 })).candidates).toBe(1);
  });
});

describe('disponibilidade (RF-38)', () => {
  it('/discover: título num serviço assinado sobe com "por que isso"; sem assinatura, sem boost', async () => {
    const me = await newUser();
    const farol = await me.addTitle('O Farol de Papel', 2021);
    await me.post(`/library/${farol}/enrich`, {}).expect(200);
    // outro drama/romance sem streaming, com a mesma prioridade: sem assinatura, o empate fica com o mais antigo (o Farol)
    await me.addTitle('Drama Sem Streaming', 2015, { genres: ['drama', 'romance'] });

    const before = (await me.post('/discover', { mode: 'surprise', genre: 'drama' }).expect(200)).body;
    expect(before.suggestions.every((s: { reason: string }) => !s.reason.includes('assina'))).toBe(true);

    await me.put('/profile/subscriptions', { providers: ['netflix'] }).expect(200);
    const after = (await me.post('/discover', { mode: 'surprise', genre: 'drama' }).expect(200)).body;
    expect(after.suggestions[0].title.id).toBe(farol);
    expect(after.suggestions[0].reason).toContain('disponível na Netflix, que você assina');
    expect(after.suggestions[0].score).toBeGreaterThan(after.suggestions[1].score);
  });

  it('"Continuar" mostra onde o próximo item está disponível', async () => {
    const me = await newUser();
    const first = await me.addTitle('Primeiro da Lista', 2000, { genres: ['comedy'] });
    const farol = await me.addTitle('O Farol de Papel', 2021);
    await me.post(`/library/${farol}/enrich`, {}).expect(200);
    await me.post('/lists', { name: 'Maratona', titleIds: [first, farol] }).expect(201);
    await me.patch(`/library/${first}`, { status: 'watched' }).expect(200);
    await me.put('/profile/subscriptions', { providers: ['netflix'] }).expect(200);
    const home = (await me.get('/home').expect(200)).body;
    expect(home.continue.next.id).toBe(farol);
    expect(home.continue.availability).toBe('Disponível na Netflix, que você assina');
  });
});

describe('"Como estou" e o intérprete (RNF-07/09)', () => {
  function spyInterpreter() {
    const calls: LlmSafeInput[] = [];
    const interpreter: MoodInterpreter = {
      name: 'anthropic',
      interpret: async (input) => {
        calls.push(input);
        return { intent: interpretMood(input.userText) as MoodIntent, interpreter: 'anthropic', usage: { inputTokens: 300, outputTokens: 50 }, costUsd: 0.00055 };
      },
    };
    return { calls, interpreter };
  }

  it('risco detectado: o LLM nunca é chamado, nem quando o usuário escolhe continuar', async () => {
    const me = await newUser();
    const { calls, interpreter } = spyInterpreter();
    const service = new LibraryService(db, testEnv({ AI_MODE: 'anthropic' }), interpreter);
    const risky = 'não aguento mais, quero morrer';
    const first = await service.discover(me.userId, { mode: 'mood', text: risky });
    expect(first.risk).not.toBeNull();
    const cont = await service.discover(me.userId, { mode: 'mood', text: risky, continueAfterRisk: true });
    expect(cont.risk).toBeNull();
    expect(cont.interpreter).toBe('rules');
    expect(calls).toHaveLength(0);
  });

  it('sem risco: o intérprete recebe só o texto; custo e intérprete ficam no run, o texto não', async () => {
    const me = await newUser();
    const { calls, interpreter } = spyInterpreter();
    const service = new LibraryService(db, testEnv({ AI_MODE: 'anthropic' }), interpreter);
    await setUserSettings(db, me.userId, { aiConsent: true });
    const text = 'estou triste, sofrendo por amor';
    const res = await service.discover(me.userId, { mode: 'mood', text });
    expect(calls).toEqual([{ userText: text }]);
    expect(res.interpreter).toBe('anthropic');
    const [run] = await withUser(db, me.userId, (tx) => tx.select().from(recommendationRuns).where(eq(recommendationRuns.id, res.runId)));
    expect(run!.interpreter).toBe('anthropic');
    expect(run!.inputTokens).toBe(300);
    expect(run!.costUsd).toBeCloseTo(0.00055, 8);
    expect(JSON.stringify(run)).not.toContain('sofrendo');
  });

  it('HTTP com AI_MODE padrão: intérprete por regras, custo zero', async () => {
    const me = await newUser();
    const res = (await me.post('/discover', { mode: 'mood', text: 'quero rir' }).expect(200)).body;
    expect(res.interpreter).toBe('rules');
    const [run] = await withUser(db, me.userId, (tx) => tx.select().from(recommendationRuns).where(eq(recommendationRuns.id, res.runId)));
    expect(run!.costUsd).toBe(0);
  });
});
