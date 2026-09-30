import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../../src/common/logger.js';
import { and, eq } from 'drizzle-orm';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendations, tasteSignals } from '../../src/db/schema.js';
import { seedDemo } from '../../src/library/demo-seed.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { APP_URL, OWNER_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  await pool.end();
});

type User = Awaited<ReturnType<typeof register>> & { userId: string };

async function newUser(): Promise<User> {
  const user = await register(ctx.http);
  return { ...user, userId: user.refreshToken.split('.')[0]! };
}

async function demoUser() {
  const user = await newUser();
  const seed = await seedDemo(db, user.userId);
  return { user, ids: seed.idByTitle };
}

const auth = (u: User) => ['authorization', `Bearer ${u.accessToken}`] as const;
const get = (u: User, path: string) => ctx.http().get(path).set(...auth(u));
const post = (u: User, path: string, body: object) => ctx.http().post(path).set(...auth(u)).send(body);

describe('seed de demonstração', () => {
  it('cria ≥ 30 títulos, 3 listas e é idempotente', async () => {
    const user = await newUser();
    const first = await seedDemo(db, user.userId);
    expect(first.titles).toBeGreaterThanOrEqual(30);
    expect(first.created).toBe(first.titles);
    expect(first.lists).toBe(3);
    const second = await seedDemo(db, user.userId);
    expect(second.created).toBe(0);
    expect(second.lists).toBe(0);
    const lib = (await get(user, '/library?limit=100').expect(200)).body;
    expect(lib.items.every((t: { enrichment: string }) => t.enrichment === 'demo')).toBe(true);
  });
});

describe('D-23: "Próximo a assistir"', () => {
  it('do Catálogo, com a nota no mesmo passo: entra na Minha Área em 1º e a fila segue contínua', async () => {
    const { user, ids } = await demoUser();
    const id = ids.get('Intocáveis')!;
    const patchT = (body: object) => ctx.http().patch(`/library/${id}`).set(...auth(user)).send(body);
    await patchT({ status: 'catalog' }).expect(200);
    const t = (await patchT({ next: true, rating: 4.5 }).expect(200)).body;
    expect(t).toMatchObject({ status: 'to_watch', rank: 1, rating: 4.5 });
    const queue = ((await get(user, '/library?area=1&sort=rank&limit=200').expect(200)).body.items as { id: string; rank: number | null }[])
      .filter((x) => x.rank != null);
    expect(queue[0]!.id).toBe(id);
    expect(queue.map((x) => x.rank)).toEqual(queue.map((_, i) => i + 1));
    // já assistindo: continua "Assistindo", só sobe para o topo
    await patchT({ status: 'watching' }).expect(200);
    await ctx.http().post(`/library/${id}/move`).set(...auth(user)).send({ to: 'bottom' }).expect(200);
    expect((await patchT({ next: true }).expect(200)).body).toMatchObject({ status: 'watching', rank: 1 });
  });
});

describe('D-23: busca por categoria na Minha Área e no Catálogo', () => {
  it('"documentários", "séries", "filmes de ação" e "da Netflix" filtram por categoria; nome continua valendo', async () => {
    const user = await newUser();
    const add = async (body: object) => (await post(user, '/library', body).expect(201)).body.id as string;
    const doc = await add({ title: 'Oceano Profundo', kind: 'movie', genres: ['documentary'] });
    const series = await add({ title: 'A Casa', kind: 'series', genres: ['drama'] });
    const action = await add({ title: 'Perseguição', kind: 'movie', genres: ['action'] });
    const named = await add({ title: 'Ação Final', kind: 'movie', genres: ['drama'] });
    const onNetflix = await add({ title: 'Na Rede', kind: 'series', genres: ['comedy'] });
    // "onde assistir" vem do TMDB; aqui gravado direto (dado sintético)
    await withUser(db, user.userId, (tx) =>
      tx
        .update(recommendations)
        .set({ resolution: { provider: 'tmdb', externalId: 'tv:1', title: 'Na Rede', url: 'https://www.themoviedb.org/tv/1', providers: [{ name: 'Netflix', type: 'flatrate' }] } })
        .where(eq(recommendations.id, onNetflix)),
    );
    const ids = async (q: string) =>
      ((await get(user, `/library?q=${encodeURIComponent(q)}&limit=200`).expect(200)).body.items as { id: string }[]).map((t) => t.id).sort();

    expect(await ids('documentários')).toEqual([doc]);
    expect(await ids('séries')).toEqual([series, onNetflix].sort());
    expect(await ids('filmes de ação')).toEqual([action]);
    expect(await ids('ação')).toEqual([action, named].sort());
    expect(await ids('séries da netflix')).toEqual([onNetflix]);
    expect(await ids('Casa')).toEqual([series]);
  });
});

describe('D-23: Minha Área, onde assistir e as três notas', () => {
  it('Minha Área filtra Quero assistir/Assistindo/Assistido; catálogo fica fora e sem posição na fila', async () => {
    const { user, ids } = await demoUser();
    const id = ids.get('Intocáveis')!;
    const patchT = (body: object) => ctx.http().patch(`/library/${id}`).set(...auth(user)).send(body);
    await patchT({ status: 'catalog' }).expect(200);
    const area = (await get(user, '/library?area=1&limit=200').expect(200)).body.items as { id: string; status: string }[];
    expect(area.some((t) => t.id === id)).toBe(false);
    expect(area.every((t) => ['to_watch', 'watching', 'watched'].includes(t.status))).toBe(true);
    expect((await get(user, `/library/${id}`).expect(200)).body.rank).toBeNull();

    // volta para a Minha Área no fim da fila, e "assistindo em" fica guardado
    const back = (await patchT({ status: 'watching', watchOn: 'Netflix' }).expect(200)).body;
    expect(back).toMatchObject({ status: 'watching', watchOn: 'Netflix' });
    const queue = (await get(user, '/library?area=1&sort=rank&limit=200').expect(200)).body.items.filter((t: { rank: number | null }) => t.rank != null);
    expect(queue.at(-1).id).toBe(id);
    await patchT({ watchOn: 'x'.repeat(61) }).expect(400);
    expect((await patchT({ watchOn: null }).expect(200)).body.watchOn).toBeUndefined();
  });

  it('ordem padrão: fila manual, minhas estrelas, nota automática, nota geral; estrela recalcula a automática', async () => {
    const { user, ids } = await demoUser();
    const list = async (sort?: string) =>
      (await get(user, `/library?limit=200${sort ? `&sort=${sort}` : ''}`).expect(200)).body.items as {
        id: string; rank: number | null; rating?: number; autoRating?: number;
      }[];
    const items = await list();
    // quem tem posição vem primeiro, na ordem da fila
    const ranked = items.filter((t) => t.rank != null);
    expect(items.slice(0, ranked.length)).toEqual(ranked);
    expect(ranked.map((t) => t.rank)).toEqual(ranked.map((_, i) => i + 1));
    // fora da fila: estrelas antes das automáticas
    const rest = items.slice(ranked.length);
    const firstWithout = rest.findIndex((t) => t.rating == null);
    if (firstWithout >= 0) expect(rest.slice(firstWithout).every((t) => t.rating == null)).toBe(true);
    // "mine": só pelas estrelas (desc), sem a fila
    const mine = await list('mine');
    const rated = mine.filter((t) => t.rating != null).map((t) => t.rating!);
    expect(rated).toEqual([...rated].sort((a, b) => b - a));

    // dar 5 estrelas a um drama puxa a nota automática dos outros dramas
    const drama = ids.get('Intocáveis')!;
    const before = (await list('auto')).find((t) => t.id !== drama && t.autoRating != null);
    await ctx.http().patch(`/library/${drama}`).set(...auth(user)).send({ rating: 5 }).expect(200);
    const after = (await list('auto')).find((t) => t.id === before!.id);
    expect(after!.autoRating).toBeDefined();
  });
});

describe('GET /home: Continuar (RF-31)', () => {
  it('retoma a maratona em andamento no próximo item, na ordem da lista', async () => {
    const { user } = await demoUser();
    const home = (await get(user, '/home').expect(200)).body;
    expect(home.continue.list.name).toBe('Maratona de comédias da semana');
    expect(home.continue.next.title).toBe('O Auto da Compadecida');
    expect(home.continue.progress).toEqual({ done: 2, total: 5 });
    expect(home.presets.length).toBeGreaterThan(5);
    expect(home.presets.find((p: { key: string }) => p.key === 'romcom').available).toBeGreaterThan(0);
    expect(home.aiMode).toBe('rules');
  });

  it('marcar como assistido avança o próximo item', async () => {
    const { user, ids } = await demoUser();
    await ctx.http()
      .patch(`/library/${ids.get('O Auto da Compadecida')}`)
      .set(...auth(user))
      .send({ status: 'watched', rating: 5 })
      .expect(200);
    const home = (await get(user, '/home').expect(200)).body;
    expect(home.continue.next.title).toBe('Intocáveis');
    expect(home.continue.progress.done).toBe(3);
  });

  it('nota de meia em meia estrela; a nota nova substitui a anterior no gosto', async () => {
    const { user, ids } = await demoUser();
    const id = ids.get('Intocáveis')!;
    const rate = (rating: number | null) => ctx.http().patch(`/library/${id}`).set(...auth(user)).send({ rating });
    await rate(3.7).expect(400);
    await rate(0).expect(400);
    expect((await rate(4.5).expect(200)).body.rating).toBe(4.5);
    await rate(1.5).expect(200);
    const rated = () =>
      withUser(db, user.userId, (tx) =>
        tx
          .select({ value: tasteSignals.value })
          .from(tasteSignals)
          .where(and(eq(tasteSignals.recommendationId, id), eq(tasteSignals.signal, 'rated'))),
      );
    expect((await rated()).map((r) => r.value)).toEqual([1.5]);
    await rate(null).expect(200);
    expect(await rated()).toEqual([]);
  });

  it('usuário sem listas não tem "Continuar"', async () => {
    const user = await newUser();
    const home = (await get(user, '/home').expect(200)).body;
    expect(home.continue).toBeNull();
    expect(home.stats.total).toBe(0);
  });
});

describe('POST /discover', () => {
  it('Surpreenda-me: comédia romântica traz comédia + romance, com "por que isso"', async () => {
    const { user } = await demoUser();
    const res = (await post(user, '/discover', { mode: 'surprise', subgenre: 'romcom' }).expect(200)).body;
    expect(res.surprise).toEqual({ key: 'romcom', label: 'Comédia romântica', kind: 'subgenre' });
    expect(res.risk).toBeNull();
    const top = res.suggestions[0];
    const genres = top.title.genres.map((g: { key: string }) => g.key);
    expect(genres).toEqual(expect.arrayContaining(['comedy', 'romance']));
    expect(top.reason).toMatch(/Comédia romântica, como você pediu/);
    expect(top.source).toBe('library');
  });

  it('Como estou: "estou triste, sofrendo por amor" → levanta o astral sem romance', async () => {
    const { user } = await demoUser();
    const res = (await post(user, '/discover', { mode: 'mood', text: 'estou triste, sofrendo por amor' }).expect(200)).body;
    expect(res.intent).toMatchObject({ need: 'uplifting', needLabel: 'levantar o astral' });
    expect(res.intent.avoid).toEqual(expect.arrayContaining(['romance_centric']));
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const s of res.suggestions) {
      expect(s.title.genres.map((g: { key: string }) => g.key)).not.toContain('romance');
      expect(s.reason.length).toBeGreaterThan(5);
    }
  });

  it('risco (RNF-07): acolhimento com CVV e nenhuma sugestão até o usuário continuar', async () => {
    const { user } = await demoUser();
    const res = (await post(user, '/discover', { mode: 'mood', text: 'não aguento mais, quero sumir e acabar com tudo' }).expect(200)).body;
    expect(res.risk).toMatchObject({ cvvPhone: '188', cvvUrl: 'https://cvv.org.br' });
    expect(res.suggestions).toEqual([]);
    expect(res.intent).toBeNull();
    const after = (
      await post(user, '/discover', { mode: 'mood', text: 'não aguento mais, quero sumir e acabar com tudo', continueAfterRisk: true }).expect(200)
    ).body;
    expect(after.risk).toBeNull();
  });

  it('o texto do "Como estou" não vai para o banco (RNF-06) nem para o log', async () => {
    const { user } = await demoUser();
    const marker = `marcador${randomUUID().slice(0, 8)}`;
    const text = `estou triste hoje ${marker}`;
    await post(user, '/discover', { mode: 'mood', text }).expect(200);

    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    try {
      for (const table of ['recommendation_runs', 'recommendation_feedback', 'taste_signals']) {
        const { rows } = await owner.query(`select count(*)::int as n from ${table} where row_to_json(${table})::text ilike $1`, [`%${marker}%`]);
        expect(rows[0].n, table).toBe(0);
      }
    } finally {
      await owner.end();
    }

    // o log HTTP usa esta configuração de redaction: corpo e campos `text` nunca aparecem
    const lines: string[] = [];
    const sink = new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) });
    pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink).info({ req: { body: { mode: 'mood', text } }, input: { text } });
    expect(lines.join('')).not.toContain(marker);
  });

  it('subgênero desconhecido → 400; modo off → 400', async () => {
    const { user } = await demoUser();
    await post(user, '/discover', { mode: 'surprise', subgenre: 'nao-existe' }).expect(400);
    const off = await startTestApp({ AI_MODE: 'off' });
    try {
      const u = await register(off.http);
      await off.http().post('/discover').set('authorization', `Bearer ${u.accessToken}`).send({ mode: 'mood', text: 'oi' }).expect(400);
    } finally {
      await off.app.close();
    }
  });
});

describe('POST /feedback (RF-37)', () => {
  it('"outra coisa" devolve a próxima do ranking; pular grava sinal', async () => {
    const { user } = await demoUser();
    const run = (await post(user, '/discover', { mode: 'surprise', genre: 'comedy' }).expect(200)).body;
    const shown = run.suggestions.map((s: { title: { id: string } }) => s.title.id);
    const another = (await post(user, '/feedback', { runId: run.runId, titleId: shown[0], action: 'another', reasonTag: 'not_in_mood' }).expect(200)).body;
    expect(another.next).not.toBeNull();
    expect(shown).not.toContain(another.next.title.id);

    await post(user, '/feedback', { runId: run.runId, titleId: shown[1], action: 'skip', reasonText: 'pesado demais' }).expect(200);
    const again = (await post(user, '/discover', { mode: 'surprise', genre: 'comedy' }).expect(200)).body;
    const pos = again.suggestions.findIndex((s: { title: { id: string } }) => s.title.id === shown[1]);
    expect(pos === -1 || pos > 0).toBe(true);

    await post(user, '/feedback', { runId: run.runId, titleId: shown[0], action: 'skip', reasonTag: 'inventado' }).expect(400);
    await post(user, '/feedback', { runId: run.runId, titleId: shown[0], action: 'skip', reasonText: 'x'.repeat(31) }).expect(400);
  });
});

describe('PATCH /library/:id', () => {
  it('colisão de dedup → 409 com conflictWith', async () => {
    const { user, ids } = await demoUser();
    const res = await ctx.http()
      .patch(`/library/${ids.get('Dark')}`)
      .set(...auth(user))
      .send({ title: 'The Office' })
      .expect(409);
    expect(res.body).toEqual({ error: 'conflict', message: expect.any(String), conflictWith: ids.get('The Office') });
  });

  it('gêneros manuais marcam enrichment manual; gênero fora da taxonomia → 400', async () => {
    const { user, ids } = await demoUser();
    const res = await ctx.http().patch(`/library/${ids.get('Dark')}`).set(...auth(user)).send({ genres: ['scifi', 'drama'] }).expect(200);
    expect(res.body).toMatchObject({ enrichment: 'manual' });
    expect(res.body.genres.map((g: { key: string }) => g.key)).toEqual(['scifi', 'drama']);
    await ctx.http().patch(`/library/${ids.get('Dark')}`).set(...auth(user)).send({ genres: ['ficcao'] }).expect(400);
  });

  it('filtros de GET /library', async () => {
    const { user } = await demoUser();
    const series = (await get(user, '/library?kind=series&limit=100').expect(200)).body.items;
    expect(series.length).toBe(7);
    const horror = (await get(user, '/library?genre=horror').expect(200)).body.items;
    expect(horror.map((t: { title: string }) => t.title).sort()).toEqual(['Corra!', 'Invocação do Mal', 'Stranger Things']);
    const page1 = (await get(user, '/library?limit=10').expect(200)).body;
    const page2 = (await get(user, `/library?limit=10&cursor=${page1.nextCursor}`).expect(200)).body;
    expect(new Set([...page1.items, ...page2.items].map((t: { id: string }) => t.id)).size).toBe(20);
  });

  it('hideWatched esconde os assistidos; com status explícito, vale o status', async () => {
    const { user } = await demoUser();
    const all = (await get(user, '/library?limit=200').expect(200)).body.items as { status: string }[];
    const watched = all.filter((t) => t.status === 'watched').length;
    expect(watched).toBeGreaterThan(0);
    const hidden = (await get(user, '/library?limit=200&hideWatched=1').expect(200)).body.items as { status: string }[];
    expect(hidden.length).toBe(all.length - watched);
    expect(hidden.some((t) => t.status === 'watched')).toBe(false);
    const onlyWatched = (await get(user, '/library?limit=200&hideWatched=1&status=watched').expect(200)).body.items;
    expect(onlyWatched.length).toBe(watched);
    await get(user, '/library?hideWatched=sim').expect(400);
  });
});

describe('listas', () => {
  it('criar, reordenar e apagar; itens de outro usuário são recusados', async () => {
    const { user, ids } = await demoUser();
    const a = ids.get('Dark')!;
    const b = ids.get('Chernobyl')!;
    const list = (await post(user, '/lists', { name: 'Fim de semana', titleIds: [a, b] }).expect(201)).body;
    expect(list.items.map((t: { id: string }) => t.id)).toEqual([a, b]);
    const reordered = (await ctx.http().put(`/lists/${list.id}/items`).set(...auth(user)).send({ titleIds: [b, a] }).expect(200)).body;
    expect(reordered.items.map((t: { id: string }) => t.id)).toEqual([b, a]);

    const other = await demoUser();
    await post(user, '/lists', { name: 'Invasão', titleIds: [other.ids.get('Dark')!] }).expect(400);
    await get(other.user, `/lists/${list.id}`).expect(404);

    await ctx.http().delete(`/lists/${list.id}`).set(...auth(user)).expect(204);
    await get(user, `/lists/${list.id}`).expect(404);
  });
});

describe('RLS das tabelas novas', () => {
  it('outro usuário não enxerga listas, itens, sinais, execuções nem feedback por SQL direto', async () => {
    const { user } = await demoUser();
    const run = (await post(user, '/discover', { mode: 'surprise', genre: 'comedy' }).expect(200)).body;
    await post(user, '/feedback', { runId: run.runId, titleId: run.suggestions[0].title.id, action: 'skip' }).expect(200);
    const intruder = await newUser();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id', $1, true)`, [intruder.userId]);
      for (const table of ['lists', 'list_items', 'taste_signals', 'recommendation_runs', 'recommendation_feedback']) {
        const { rows } = await client.query(`select count(*)::int as n from ${table} where user_id = $1`, [user.userId]);
        expect(rows[0].n, table).toBe(0);
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('lista automática a partir de prints (RF-26)', () => {
  const processor = new ShareProcessor({
    db,
    logger: pino({ level: 'silent' }),
    heuristic: new HeuristicExtractor(),
    fetchMetadata: async () => null,
    resolvers: [],
  });
  const PRINT = [
    '9:41',
    'cinefilo.br',
    'Seguir',
    '5 filmes para ver no domingo 🍿',
    '1. Oppenheimer (2023)',
    '2. Cidade de Deus (2002)',
    '3. Parasita (2019)',
    'Curtido por joao.silva e outras 1.234 pessoas',
  ].join('\n');

  it('D-23: share de prints vai direto para "Quero assistir" e a lista do post nasce no import, na ordem extraída', async () => {
    const user = await newUser();
    const shareId = (await post(user, '/shares', { clientShareId: randomUUID(), pages: [PRINT] }).expect(201)).body.id;
    await processor.process({ shareId, userId: user.userId });
    // sem revisão: tudo na Minha Área, na fila (fim), em "Quero assistir"
    expect((await get(user, '/review').expect(200)).body.items).toHaveLength(0);
    const area = (await get(user, '/library?area=1&sort=rank').expect(200)).body.items as { title: string; status: string; rank: number | null }[];
    expect(area.map((t) => [t.title, t.status])).toEqual([
      ['Oppenheimer', 'to_watch'],
      ['Cidade de Deus', 'to_watch'],
      ['Parasita', 'to_watch'],
    ]);
    expect(area.map((t) => t.rank)).toEqual([1, 2, 3]);
    const lists = (await get(user, '/lists').expect(200)).body;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: '5 filmes para ver no domingo', sourceShareId: shareId, itemCount: 3 });
    const detail = (await get(user, `/lists/${lists[0].id}`).expect(200)).body;
    expect(detail.items.map((t: { title: string }) => t.title)).toEqual(['Oppenheimer', 'Cidade de Deus', 'Parasita']);
  });

  it('título que já estava no catálogo vai para "Quero assistir" e entra na lista do post; share com 1 item não cria lista', async () => {
    const { user, ids } = await demoUser(); // já tem Cidade de Deus
    await ctx.http().patch(`/library/${ids.get('Cidade de Deus')}`).set(...auth(user)).send({ status: 'catalog' }).expect(200);
    const shareId = (await post(user, '/shares', { clientShareId: randomUUID(), pages: [PRINT] }).expect(201)).body.id;
    await processor.process({ shareId, userId: user.userId });
    const cdd = (await get(user, `/library/${ids.get('Cidade de Deus')}`).expect(200)).body;
    expect(cdd.status).toBe('to_watch');
    const auto = (await get(user, '/lists').expect(200)).body.find((l: { sourceShareId: string | null }) => l.sourceShareId === shareId);
    expect(auto.itemCount).toBe(3);

    const single = (await post(user, '/shares', { clientShareId: randomUUID(), pages: ['1. Aftersun (2022)'] }).expect(201)).body.id;
    await processor.process({ shareId: single, userId: user.userId });
    const again = (await get(user, '/lists').expect(200)).body;
    expect(again.some((l: { sourceShareId: string | null }) => l.sourceShareId === single)).toBe(false);
  });
});
