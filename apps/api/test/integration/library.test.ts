import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../../src/common/logger.js';
import { createDb } from '../../src/db/client.js';
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

  it('share de prints com ≥ 2 itens vira lista com nome do cabeçalho, na ordem extraída', async () => {
    const user = await newUser();
    const shareId = (await post(user, '/shares', { clientShareId: randomUUID(), pages: [PRINT] }).expect(201)).body.id;
    await processor.process({ shareId, userId: user.userId });
    const lists = (await get(user, '/lists').expect(200)).body;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: '5 filmes para ver no domingo', sourceShareId: shareId, itemCount: 3 });
    const detail = (await get(user, `/lists/${lists[0].id}`).expect(200)).body;
    expect(detail.items.map((t: { title: string }) => t.title)).toEqual(['Oppenheimer', 'Cidade de Deus', 'Parasita']);
  });

  it('item que o usuário já tinha entra na lista do post; share com 1 item não gera lista', async () => {
    const { user } = await demoUser(); // já tem Cidade de Deus
    const shareId = (await post(user, '/shares', { clientShareId: randomUUID(), pages: [PRINT] }).expect(201)).body.id;
    await processor.process({ shareId, userId: user.userId });
    const auto = (await get(user, '/lists').expect(200)).body.find((l: { sourceShareId: string | null }) => l.sourceShareId === shareId);
    expect(auto.itemCount).toBe(3);

    const single = (await post(user, '/shares', { clientShareId: randomUUID(), pages: ['1. Aftersun (2022)'] }).expect(201)).body.id;
    await processor.process({ shareId: single, userId: user.userId });
    const again = (await get(user, '/lists').expect(200)).body;
    expect(again.some((l: { sourceShareId: string | null }) => l.sourceShareId === single)).toBe(false);
  });
});
