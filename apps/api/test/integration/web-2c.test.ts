// Fase 2c: auth web por cookie (RF-30), catálogo em massa com desfazer (RF-24/25), listas (RF-26),
// correção/merge e fila de revisão (RF-27/28), activity (RF-19), perfil de gosto e assinaturas
// (RF-29/38, RNF-10), histórico de humor (RNF-06) e sandbox (RF-19/22).
import { randomUUID } from 'node:crypto';
import { WEB_REFRESH_COOKIE } from '@fruiqo/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import {
  bulkUndo,
  candidateDecisions,
  recommendations,
  reviewActions,
  shares,
  tasteOverrides,
  tasteSubgenrePrefs,
  userSubscriptions,
} from '../../src/db/schema.js';
import { seedDemo } from '../../src/library/demo-seed.js';
import { dedupKey } from '../../src/pipeline/dedup.js';
import { APP_URL } from '../helpers.js';
import { PASSWORD, register, startTestApp } from './app.js';

const WEB = 'http://localhost:5173';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
let sandboxOff: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp({ WEB_ORIGIN: WEB, SANDBOX_ENABLED: 'true' });
  sandboxOff = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await sandboxOff.app.close();
  await pool.end();
});

const userIdOf = (u: { refreshToken: string }) => u.refreshToken.split('.')[0]!;

function refreshCookie(res: { headers: Record<string, unknown> }): { value: string; raw: string } | undefined {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith(`${WEB_REFRESH_COOKIE}=`));
  if (!raw) return undefined;
  return { raw, value: raw.split(';')[0]!.slice(WEB_REFRESH_COOKIE.length + 1) };
}

function webLogin(email: string) {
  return ctx
    .http()
    .post('/auth/login')
    .set('X-Fruiqo-Client', 'web')
    .set('Origin', WEB)
    .send({ email, password: PASSWORD, deviceName: 'navegador' });
}

function webRefresh(cookie: string | undefined, origin = WEB, header = true) {
  let req = ctx.http().post('/auth/refresh').set('Origin', origin);
  if (header) req = req.set('X-Fruiqo-Client', 'web');
  if (cookie) req = req.set('Cookie', `${WEB_REFRESH_COOKIE}=${cookie}`);
  return req.send({});
}

describe('auth web por cookie (RF-30)', () => {
  it('login web: refresh só no cookie httpOnly/SameSite=Strict/Path=/auth; corpo sem refreshToken', async () => {
    const user = await register(ctx.http);
    const res = await webLogin(user.email).expect(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = refreshCookie(res)!;
    expect(cookie).toBeDefined();
    expect(cookie.raw).toMatch(/HttpOnly/i);
    expect(cookie.raw).toMatch(/SameSite=Strict/i);
    expect(cookie.raw).toMatch(/Path=\/auth/);
    expect(cookie.raw).not.toMatch(/Secure/i); // origem http de dev
  });

  it('refresh por cookie rotaciona; reuso do cookie antigo revoga a sessão', async () => {
    const user = await register(ctx.http);
    const c0 = refreshCookie(await webLogin(user.email).expect(200))!.value;
    const r1 = await webRefresh(c0).expect(200);
    expect(r1.body.refreshToken).toBeUndefined();
    const c1 = refreshCookie(r1)!.value;
    expect(c1).not.toBe(c0);
    // reuso do anterior → 401 e sessão revogada: nem o novo vale mais
    await webRefresh(c0).expect(401);
    await webRefresh(c1).expect(401);
  });

  it('sem o cabeçalho X-Fruiqo-Client o cookie é ignorado (CSRF)', async () => {
    const user = await register(ctx.http);
    const c0 = refreshCookie(await webLogin(user.email).expect(200))!.value;
    await webRefresh(c0, WEB, false).expect(400);
  });

  it('origem fora da allowlist é recusada no login e no refresh', async () => {
    const user = await register(ctx.http);
    await ctx
      .http()
      .post('/auth/login')
      .set('X-Fruiqo-Client', 'web')
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: PASSWORD, deviceName: 'x' })
      .expect(403);
    const c0 = refreshCookie(await webLogin(user.email).expect(200))!.value;
    await webRefresh(c0, 'https://evil.example').expect(403);
    await webRefresh(undefined).expect(401);
  });

  it('CORS com credenciais só para WEB_ORIGIN', async () => {
    const ok = await ctx
      .http()
      .options('/auth/refresh')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-fruiqo-client,content-type');
    expect(ok.headers['access-control-allow-origin']).toBe(WEB);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-headers']).toMatch(/X-Fruiqo-Client/i);
    const bad = await ctx.http().options('/auth/refresh').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('logout web limpa o cookie; mobile continua recebendo refreshToken no corpo', async () => {
    const user = await register(ctx.http);
    expect(user.refreshToken).toBeTypeOf('string');
    const login = await webLogin(user.email).expect(200);
    const out = await ctx
      .http()
      .post('/auth/logout')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .set('X-Fruiqo-Client', 'web')
      .set('Origin', WEB)
      .expect(204);
    expect(refreshCookie(out)!.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

async function seededUser() {
  const user = await register(ctx.http);
  const userId = userIdOf(user);
  const seed = await seedDemo(db, userId);
  const auth = (req: ReturnType<ReturnType<typeof ctx.http>['get']>) => req.set('authorization', `Bearer ${user.accessToken}`);
  return { user, userId, seed, auth };
}

describe('catálogo web (RF-24/25)', () => {
  it('1.000 títulos: filtros e busca respondem em menos de 1 s', async () => {
    const user = await register(ctx.http);
    const userId = userIdOf(user);
    await withUser(db, userId, async (tx) => {
      const rows = Array.from({ length: 1000 }, (_, i) => {
        const title = `Título de carga ${i}`;
        return {
          userId,
          kind: 'movie' as const,
          title,
          confidence: 1,
          extractor: 'heuristic' as const,
          dedupKey: dedupKey({ kind: 'movie', title }),
          genres: i % 2 === 0 ? ['comedy'] : ['drama'],
        };
      });
      await tx.insert(recommendations).values(rows);
    });
    const started = performance.now();
    const res = await ctx
      .http()
      .get('/library?genre=comedy&q=carga&sort=rank&limit=200')
      .set('authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(res.body.items.length).toBe(200);
    const ranks = (res.body.items as { rank: number; genres: { key: string }[] }[]).map((t) => t.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('adicionar manualmente; mesmo título de novo → 409', async () => {
    const { user } = await seededUser();
    const body = { title: 'Um Filme Qualquer', kind: 'movie', year: 2020, genres: ['drama'] };
    const res = await ctx.http().post('/library').set('authorization', `Bearer ${user.accessToken}`).send(body).expect(201);
    expect(res.body).toMatchObject({ title: 'Um Filme Qualquer', enrichment: 'manual', shareId: null });
    const clash = await ctx.http().post('/library').set('authorization', `Bearer ${user.accessToken}`).send(body).expect(409);
    expect(clash.body.conflictWith).toBe(res.body.id);
  });

  it('mover em massa para o topo + desfazer (uso único)', async () => {
    const { user } = await seededUser();
    const queue = async () =>
      ((await ctx.http().get('/library?sort=rank&limit=200').set('authorization', `Bearer ${user.accessToken}`)).body.items as {
        id: string;
        rank: number;
      }[]).map((t) => t.id);
    const before = await queue();
    const ids = [before[5]!, before[2]!, before[9]!];
    const res = await ctx
      .http()
      .post('/library/bulk')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ titleIds: ids, operation: { type: 'move_top' } })
      .expect(200);
    expect(res.body.affected).toBe(3);
    const moved = await queue();
    // os selecionados no topo, na ordem relativa que tinham; o resto mantém a ordem
    expect(moved.slice(0, 3)).toEqual([before[2], before[5], before[9]]);
    expect(moved.slice(3)).toEqual(before.filter((id) => !ids.includes(id)));
    const undo = () =>
      ctx.http().post('/library/bulk/undo').set('authorization', `Bearer ${user.accessToken}`).send({ undoToken: res.body.undoToken });
    await undo().expect(200);
    expect(await queue()).toEqual(before);
    await undo().expect(404);
  });

  it('remover em massa e desfazer devolve os títulos e as listas', async () => {
    const { user, seed } = await seededUser();
    const lists = (await ctx.http().get('/lists').set('authorization', `Bearer ${user.accessToken}`)).body as { id: string; itemCount: number }[];
    const list = lists.find((l) => l.itemCount > 0)!;
    const detail = (await ctx.http().get(`/lists/${list.id}`).set('authorization', `Bearer ${user.accessToken}`)).body as {
      items: { id: string }[];
    };
    const ids = detail.items.slice(0, 2).map((i) => i.id);
    const res = await ctx
      .http()
      .post('/library/bulk')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ titleIds: ids, operation: { type: 'delete' } })
      .expect(200);
    await ctx.http().get(`/library/${ids[0]}`).set('authorization', `Bearer ${user.accessToken}`).expect(404);
    await ctx.http().post('/library/bulk/undo').set('authorization', `Bearer ${user.accessToken}`).send({ undoToken: res.body.undoToken }).expect(200);
    const back = (await ctx.http().get(`/lists/${list.id}`).set('authorization', `Bearer ${user.accessToken}`)).body as { items: { id: string }[] };
    expect(back.items.map((i) => i.id)).toEqual(detail.items.map((i) => i.id));
    expect(seed.idByTitle.size).toBeGreaterThan(0);
  });

  it('mover entre listas e gêneros em massa (transacional: id inválido não altera nada)', async () => {
    const { user, seed } = await seededUser();
    const a = (await ctx.http().post('/lists').set('authorization', `Bearer ${user.accessToken}`).send({ name: 'A' }).expect(201)).body;
    const b = (await ctx.http().post('/lists').set('authorization', `Bearer ${user.accessToken}`).send({ name: 'B' }).expect(201)).body;
    const ids = [...seed.idByTitle.values()].slice(0, 2);
    const post = (operation: object, titleIds = ids) =>
      ctx.http().post('/library/bulk').set('authorization', `Bearer ${user.accessToken}`).send({ titleIds, operation });
    await post({ type: 'add_to_list', listId: a.id }).expect(200);
    await post({ type: 'move_to_list', fromListId: a.id, toListId: b.id }).expect(200);
    const la = (await ctx.http().get(`/lists/${a.id}`).set('authorization', `Bearer ${user.accessToken}`)).body;
    const lb = (await ctx.http().get(`/lists/${b.id}`).set('authorization', `Bearer ${user.accessToken}`)).body;
    expect(la.items).toHaveLength(0);
    expect(lb.items.map((i: { id: string }) => i.id)).toEqual(ids);

    await post({ type: 'add_genres', genres: ['western'] }, [ids[0]!, randomUUID()]).expect(400);
    const t = (await ctx.http().get(`/library/${ids[0]}`).set('authorization', `Bearer ${user.accessToken}`)).body;
    expect(t.genres.map((g: { key: string }) => g.key)).not.toContain('western');
  });
});

describe('listas (RF-26)', () => {
  it('renomear e duplicar mantendo a ordem', async () => {
    const { user, seed } = await seededUser();
    const ids = [...seed.idByTitle.values()].slice(0, 3);
    const list = (await ctx.http().post('/lists').set('authorization', `Bearer ${user.accessToken}`).send({ name: 'Original', titleIds: ids }).expect(201)).body;
    const renamed = await ctx.http().patch(`/lists/${list.id}`).set('authorization', `Bearer ${user.accessToken}`).send({ name: 'Renomeada' }).expect(200);
    expect(renamed.body.name).toBe('Renomeada');
    const copy = await ctx.http().post(`/lists/${list.id}/duplicate`).set('authorization', `Bearer ${user.accessToken}`).send({}).expect(201);
    expect(copy.body.name).toBe('Renomeada (cópia)');
    expect(copy.body.items.map((i: { id: string }) => i.id)).toEqual(ids);
  });
});

describe('correção, merge e fila de revisão (RF-27/28)', () => {
  async function reviewItem(userId: string, title: string) {
    return withUser(db, userId, async (tx) => {
      const [share] = await tx
        .insert(shares)
        .values({ userId, clientShareId: randomUUID(), status: 'done', origin: 'screenshot', pageCount: 1 })
        .returning();
      const [rec] = await tx
        .insert(recommendations)
        .values({
          userId,
          shareId: share!.id,
          kind: 'movie',
          title,
          confidence: 0.3,
          extractor: 'heuristic',
          dedupKey: dedupKey({ kind: 'movie', title }),
          decision: 'review_queue',
          decisionReason: 'low_confidence',
        })
        .returning();
      await tx.insert(candidateDecisions).values({
        userId,
        shareId: share!.id,
        recommendationId: rec!.id,
        rawTitle: title,
        kind: 'movie',
        confidenceScore: 0.3,
        decision: 'review_queue',
        reason: 'low_confidence',
      });
      return rec!.id;
    });
  }

  it('fila: listar, aprovar, rejeitar e rematch gravam review_actions', async () => {
    const { user, userId } = await seededUser();
    const a = await reviewItem(userId, 'Oppenhimer');
    const b = await reviewItem(userId, 'Lixo de OCR');
    const c = await reviewItem(userId, 'Filme Revisto Parte 2');
    const q = await ctx.http().get('/review').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(q.body.items.map((i: { title: { id: string } }) => i.title.id)).toEqual([a, b, c]);
    expect(q.body.items[0].candidate).toMatchObject({ rawTitle: 'Oppenhimer', reason: 'low_confidence' });
    expect(q.body.items[0].share.origin).toBe('screenshot');

    const approved = await ctx.http().post(`/review/${a}/approve`).set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(approved.body.decision).toBe('cataloged');
    await ctx.http().post(`/review/${b}/reject`).set('authorization', `Bearer ${user.accessToken}`).expect(204);
    await ctx.http().get(`/library/${b}`).set('authorization', `Bearer ${user.accessToken}`).expect(404);
    const re = await ctx
      .http()
      .post(`/review/${c}/rematch`)
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ title: 'Filme Revisto: Parte Dois', year: 2024 })
      .expect(200);
    expect(re.body).toMatchObject({ title: 'Filme Revisto: Parte Dois', year: 2024, decision: 'cataloged' });
    await ctx.http().post(`/review/${a}/approve`).set('authorization', `Bearer ${user.accessToken}`).expect(409);

    const actions = await withUser(db, userId, (tx) => tx.select().from(reviewActions));
    expect(actions.map((x) => x.action).sort()).toEqual(['approve', 'reject', 'rematch']);
    expect((await ctx.http().get('/review').set('authorization', `Bearer ${user.accessToken}`)).body.items).toHaveLength(0);
  });

  it('correção que colide → 409 com sugestão de merge; merge junta listas e apaga a origem', async () => {
    const { user, userId, seed } = await seededUser();
    const target = seed.idByTitle.get('Intocáveis')!;
    const dup = (await ctx.http().post('/library').set('authorization', `Bearer ${user.accessToken}`).send({ title: 'Intocáveis (duplicado do OCR)', kind: 'movie' }).expect(201)).body;
    const list = (await ctx.http().post('/lists').set('authorization', `Bearer ${user.accessToken}`).send({ name: 'Só o duplicado', titleIds: [dup.id] }).expect(201)).body;

    const clash = await ctx
      .http()
      .post(`/library/${dup.id}/correct`)
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ title: 'Intocaveis!!' })
      .expect(409);
    expect(clash.body).toMatchObject({ error: 'conflict', conflictWith: target, suggestion: 'merge' });

    const merged = await ctx.http().post(`/library/${dup.id}/merge`).set('authorization', `Bearer ${user.accessToken}`).send({ intoId: target }).expect(200);
    expect(merged.body.id).toBe(target);
    expect(merged.body.lists.map((l: { id: string }) => l.id)).toContain(list.id);
    await ctx.http().get(`/library/${dup.id}`).set('authorization', `Bearer ${user.accessToken}`).expect(404);
    const actions = await withUser(db, userId, (tx) => tx.select().from(reviewActions).where(eq(reviewActions.action, 'merge')));
    expect(actions).toHaveLength(1);
  });
});

describe('activity (RF-19/27)', () => {
  it('lista os shares com contagens e etapas', async () => {
    const user = await register(ctx.http);
    await ctx
      .http()
      .post('/shares')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ clientShareId: randomUUID(), url: 'https://youtu.be/abc123' })
      .expect(201);
    const res = await ctx.http().get('/activity').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ status: 'queued', origin: 'link', counts: { cataloged: 0, review: 0, discarded: 0 } });
  });
});

describe('perfil de gosto, assinaturas e humor (RF-29/38, RNF-06/10)', () => {
  it('excluir um gênero tira ele do ranking; fixar aparece no perfil', async () => {
    const { user } = await seededUser();
    const before = await ctx.http().post('/discover').set('authorization', `Bearer ${user.accessToken}`).send({ mode: 'surprise', subgenre: 'romcom' }).expect(200);
    expect(before.body.suggestions.length).toBeGreaterThan(0);

    const profile = await ctx
      .http()
      .patch('/profile/taste')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ exclude: ['romance'], pin: ['drama'] })
      .expect(200);
    expect(profile.body.overrides).toEqual({ pinned: ['drama'], excluded: ['romance'] });
    expect(profile.body.genres.find((g: { key: string }) => g.key === 'drama')).toMatchObject({ source: 'pinned', score: 1 });

    const after = await ctx.http().post('/discover').set('authorization', `Bearer ${user.accessToken}`).send({ mode: 'surprise', subgenre: 'romcom' }).expect(200);
    const genresShown = after.body.suggestions.flatMap((s: { title: { genres: { key: string }[] } }) => s.title.genres.map((g) => g.key));
    expect(genresShown).not.toContain('romance');

    await ctx.http().patch('/profile/taste').set('authorization', `Bearer ${user.accessToken}`).send({ clear: ['romance'] }).expect(200);
    await ctx.http().patch('/profile/taste').set('authorization', `Bearer ${user.accessToken}`).send({ exclude: ['nope'] }).expect(400);
  });

  it('níveis por gênero (incluindo gênero novo) e gosto/não gosto por subgênero; limpar volta ao aprendido', async () => {
    const { user } = await seededUser();
    const patch = (body: object) => ctx.http().patch('/profile/taste').set('authorization', `Bearer ${user.accessToken}`).send(body);
    type G = { key: string; score: number; source: string; level?: string; learnedScore?: number };
    type S = { key: string; pref?: string };

    const res = await patch({
      levels: [
        { key: 'drama', level: 'dislike' },
        { key: 'animation', level: 'like' },
        { key: 'horror', level: 'hate' },
        { key: 'comedy', level: 'love' },
      ],
      subgenres: [
        { key: 'feelgood', pref: 'like' },
        { key: 'slasher', pref: 'dislike' },
      ],
    }).expect(200);
    const genre = (k: string) => (res.body.genres as G[]).find((g) => g.key === k);
    expect(genre('drama')).toMatchObject({ source: 'manual', level: 'dislike', score: -0.5 });
    expect(genre('drama')!.learnedScore).toEqual(expect.any(Number));
    expect(genre('animation')).toMatchObject({ source: 'manual', level: 'like', score: 0.5 });
    expect(genre('horror')).toMatchObject({ source: 'excluded', level: 'hate', score: -1 });
    expect(genre('comedy')).toMatchObject({ source: 'pinned', level: 'love', score: 1 });
    expect(res.body.overrides).toEqual({ pinned: ['comedy'], excluded: ['horror'] });
    const subs = res.body.subgenres as S[];
    expect(subs.find((s) => s.key === 'feelgood')).toMatchObject({ pref: 'like' });
    expect(subs.find((s) => s.key === 'slasher')).toMatchObject({ pref: 'dislike' });

    const cleared = await patch({ clear: ['drama', 'animation'], subgenres: [{ key: 'feelgood', pref: null }] }).expect(200);
    // sem override, o gênero volta ao aprendido (ou some, se não houver sinal dele)
    for (const k of ['drama', 'animation']) {
      const g = (cleared.body.genres as G[]).find((x) => x.key === k);
      expect(g?.source ?? 'signals').toBe('signals');
      expect(g?.level).toBeUndefined();
    }
    expect((cleared.body.subgenres as S[]).find((s) => s.key === 'feelgood')?.pref).toBeUndefined();

    await patch({ levels: [{ key: 'nope', level: 'like' }] }).expect(400);
    await patch({ subgenres: [{ key: 'nope', pref: 'like' }] }).expect(400);
    await patch({ levels: [{ key: 'drama', level: 'muito' }] }).expect(400);
  });

  it('assinaturas declaradas: salvar e validar', async () => {
    const user = await register(ctx.http);
    const put = await ctx
      .http()
      .put('/profile/subscriptions')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send({ providers: ['netflix', 'spotify'] })
      .expect(200);
    expect(put.body.selected).toEqual(['netflix', 'spotify']);
    expect(put.body.available.length).toBeGreaterThan(5);
    await ctx.http().put('/profile/subscriptions').set('authorization', `Bearer ${user.accessToken}`).send({ providers: ['pirate'] }).expect(400);
  });

  it('histórico de humor tem só a intenção (sem texto) e pode ser apagado', async () => {
    const { user } = await seededUser();
    const text = 'estou triste, sofrendo por amor';
    // SEC-CTRL-50: só vira histórico com "lembrar meu humor"
    await ctx.http().patch('/profile/settings').set('authorization', `Bearer ${user.accessToken}`).send({ rememberMood: true }).expect(200);
    await ctx.http().post('/discover').set('authorization', `Bearer ${user.accessToken}`).send({ mode: 'mood', text }).expect(200);
    const hist = await ctx.http().get('/profile/mood-history').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(hist.body.items).toHaveLength(1);
    expect(hist.body.items[0].need).toBe('uplifting');
    expect(JSON.stringify(hist.body)).not.toContain('triste');
    await ctx.http().delete('/profile/mood-history').set('authorization', `Bearer ${user.accessToken}`).expect(204);
    expect((await ctx.http().get('/profile/mood-history').set('authorization', `Bearer ${user.accessToken}`)).body.items).toHaveLength(0);
  });
});

describe('sandbox (RF-19/22)', () => {
  it('lista fixtures e roda uma em mock, com diff zerado', async () => {
    const user = await register(ctx.http);
    const list = await ctx.http().get('/sandbox/fixtures').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(list.body.items.map((f: { id: string }) => f.id)).toContain('list-overlap-two-pages');
    const run = await ctx.http().post('/sandbox/fixtures/list-overlap-two-pages/run').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(run.body.passed).toBe(true);
    expect(run.body.shares[0].steps.length).toBeGreaterThan(0);
    // o usuário efêmero some; nada da fixture fica na biblioteca de quem pediu
    const lib = await ctx.http().get('/library').set('authorization', `Bearer ${user.accessToken}`).expect(200);
    expect(lib.body.items).toHaveLength(0);
  });

  it('desligado (SANDBOX_ENABLED=false) → 404', async () => {
    const user = await register(sandboxOff.http);
    await sandboxOff.http().get('/sandbox/fixtures').set('authorization', `Bearer ${user.accessToken}`).expect(404);
  });
});

describe('RLS das tabelas novas', () => {
  it('usuário B não enxerga dados de A em review_actions, taste_overrides, user_subscriptions e bulk_undo (e taste_subgenre_prefs)', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const { users } = await import('../../src/db/schema.js');
    for (const id of [a, b]) {
      await withUser(db, id, (tx) => tx.insert(users).values({ id, email: `${id}@rls.test`, passwordHash: 'x' }));
    }
    await withUser(db, a, async (tx) => {
      await tx.insert(reviewActions).values({ userId: a, action: 'approve', before: {}, after: {} });
      await tx.insert(tasteOverrides).values({ userId: a, genre: 'drama', mode: 'pin' });
      await tx.insert(tasteSubgenrePrefs).values({ userId: a, subgenre: 'feelgood', pref: 'like' });
      await tx.insert(userSubscriptions).values({ userId: a, provider: 'netflix' });
      await tx.insert(bulkUndo).values({ userId: a, operation: 'delete', snapshot: {}, expiresAt: new Date(Date.now() + 60_000) });
    });
    const seen = await withUser(db, b, async (tx) => [
      (await tx.select().from(reviewActions)).length,
      (await tx.select().from(tasteOverrides)).length,
      (await tx.select().from(userSubscriptions)).length,
      (await tx.select().from(bulkUndo)).length,
      (await tx.select().from(tasteSubgenrePrefs)).length,
    ]);
    expect(seen).toEqual([0, 0, 0, 0, 0]);
    // B também não consegue gravar em nome de A
    await expect(withUser(db, b, (tx) => tx.insert(tasteOverrides).values({ userId: a, genre: 'horror', mode: 'exclude' }))).rejects.toThrow();
    await expect(withUser(db, b, (tx) => tx.insert(tasteSubgenrePrefs).values({ userId: a, subgenre: 'slasher', pref: 'dislike' }))).rejects.toThrow();
    // nível fora do intervalo ou sem valor é recusado pelo banco
    await expect(withUser(db, a, (tx) => tx.insert(tasteOverrides).values({ userId: a, genre: 'war', mode: 'level', score: 2 }))).rejects.toThrow();
    await expect(withUser(db, a, (tx) => tx.insert(tasteOverrides).values({ userId: a, genre: 'war', mode: 'level' }))).rejects.toThrow();
  });
});
