// RF-42 (revisão obrigatória com encaixe), RF-43 (perfil declarado), RF-44 (rascunho de prioridade),
// RF-46 (busca inteligente + importar) e RF-47 (.txt). TMDB pelas gravações sintéticas (mock).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withUser } from '../../src/db/client.js';
import { recommendations } from '../../src/db/schema.js';
import { seedDemo } from '../../src/library/demo-seed.js';
import { LibraryService } from '../../src/library/library.service.js';
import { ReviewService } from '../../src/library/review.service.js';
import { SearchService } from '../../src/library/search.service.js';
import type { AiTitleFinder } from '../../src/library/ai-title-finder.js';
import type { TasteAi, TasteBrief } from '../../src/library/taste-ai.js';
import { TonightService } from '../../src/library/tonight.service.js';
import { CatalogService } from '../../src/library/catalog.service.js';
import type { TitleGuesser } from '../../src/library/title-guesser.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { FIXTURES_DIR, PipelineGateway } from '../../src/pipeline/gateway.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';
import { APP_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';
import { setUserSettings } from './settings-helpers.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);
const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: [FIXTURES_DIR] });
const processor = new ShareProcessor({
  db,
  logger: pino({ level: 'silent' }),
  heuristic: new HeuristicExtractor(),
  fetchMetadata: async () => null,
  resolvers: [new TmdbResolver('mock-key', gateway.fetchImpl)],
});
const SERIES_TXT = readFileSync(join(FIXTURES_DIR, 'txt-series-list', 'lista-series.txt'), 'utf8');

beforeAll(async () => {
  ctx = await startTestApp({ PIPELINE_MODE: 'mock' });
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
const auth = (u: User) => ['authorization', `Bearer ${u.accessToken}`] as const;
const get = (u: User, path: string) => ctx.http().get(path).set(...auth(u));
const post = (u: User, path: string, body: object = {}) => ctx.http().post(path).set(...auth(u)).send(body);
const patch = (u: User, path: string, body: object) => ctx.http().patch(path).set(...auth(u)).send(body);
const put = (u: User, path: string, body: object) => ctx.http().put(path).set(...auth(u)).send(body);
const del = (u: User, path: string) => ctx.http().delete(path).set(...auth(u));

interface ReviewItemBody {
  title: { id: string; title: string; rank: number | null; decision: string; suggestedDecision?: string; matchScore?: number; resolution?: { externalId: string; title: string } };
  fit: { position: number; total: number; score: number; reasons: string[] } | null;
  alternatives: { tmdbId: number; mediaType: string; title: string; year?: number; score: number }[];
  proposedList: { name: string; shareId: string; listId: string | null } | null;
  duplicateOf: { id: string } | null;
}

async function importTxt(user: User) {
  const res = await post(user, '/shares', { clientShareId: randomUUID(), textFile: { name: 'lista series.txt', content: SERIES_TXT } }).expect(201);
  expect(res.body.source).toMatchObject({ origin: 'text_file', title: 'lista series.txt' });
  await processor.process({ shareId: res.body.id, userId: user.userId });
  // D-23: sem revisão, o import cai direto na Minha Área (Quero assistir), na ordem do arquivo
  const titles = (await get(user, '/library?area=1&sort=rank&limit=100').expect(200)).body.items as ReviewItemBody['title'][];
  return { shareId: res.body.id as string, items: titles.map((title) => ({ title })) };
}

async function queue(user: User) {
  const body = (await get(user, '/library?limit=100&sort=rank').expect(200)).body;
  return (body.items as { id: string; title: string; rank: number }[]).filter((t) => t.rank != null).sort((a, b) => a.rank - b.rank);
}

describe('RF-47 + D-23: .txt vai inteiro para "Quero assistir", com match e lista do arquivo', () => {
  it('17 itens na ordem do arquivo, na fila; erro de digitação e homônimo resolvidos', async () => {
    const user = await newUser();
    const { shareId, items } = await importTxt(user);
    expect(items).toHaveLength(17);
    expect(items.map((i) => i.title.title).slice(0, 3)).toEqual(['Bebe Lontra', 'Olhos que julgam', 'Chernoville']);
    expect(items.every((i) => i.title.decision === 'cataloged')).toBe(true);
    expect(items.map((i) => i.title.rank)).toEqual(items.map((_, i) => i + 1));
    expect(items.every((i) => i.title.resolution?.externalId.startsWith('tv:'))).toBe(true);

    const heron = items.find((i) => i.title.title === 'Back Heron')!;
    expect(heron.title.resolution).toMatchObject({ externalId: 'tv:9910010', title: 'Black Heron' });
    const monstra = items.find((i) => i.title.title === 'Monstra')!;
    expect(monstra.title.resolution?.externalId).toBe('tv:9910017');
    expect(monstra.title.suggestedDecision).toBe('cataloged');

    // a lista do arquivo nasce no import, com os 17 na ordem
    const lists = (await get(user, '/lists').expect(200)).body;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'lista series', sourceShareId: shareId, itemCount: 17 });
    expect(await queue(user)).toHaveLength(17);
  });

describe('RF-43: perfil declarado', () => {
  it('resumo interpretado por regras, favoritos e o encaixe explicando', async () => {
    const user = await newUser();
    const declared = (await put(user, '/profile/summary', { summary: 'Adoro séries de crime e mistério. Não gosto de terror.' }).expect(200)).body;
    expect(declared.interpreted.likes.map((g: { key: string }) => g.key)).toEqual(expect.arrayContaining(['crime', 'mystery']));
    expect(declared.interpreted.dislikes.map((g: { key: string }) => g.key)).toEqual(['horror']);
    expect(declared.affinities.find((a: { key: string }) => a.key === 'horror')).toMatchObject({ score: -0.9, source: 'summary' });

    // favorito escolhido na busca: resolvido pelo id (gêneros do TMDB)
    const fav = (await post(user, '/profile/favorites', { title: 'Mindcatcher', tmdbId: 9910016, mediaType: 'tv', rating: 5, comment: 'demais' }).expect(201)).body;
    expect(fav).toMatchObject({ title: 'Mindcatcher', kind: 'series', rating: 5, tmdbId: 9910016 });
    expect(fav.genres.map((g: { key: string }) => g.key).sort()).toEqual(['crime', 'drama', 'mystery']);
    // sem match no catálogo: fica sem gêneros, sem erro
    const loose = (await post(user, '/profile/favorites', { title: 'Obra Sem Catálogo', kind: 'movie' }).expect(201)).body;
    expect(loose.genres).toEqual([]);
    expect((await get(user, '/profile/declared').expect(200)).body.favorites).toHaveLength(2);
    await del(user, `/profile/favorites/${loose.id}`).expect(204);
    await del(user, `/profile/favorites/${loose.id}`).expect(404);

    const taste = (await get(user, '/profile/taste').expect(200)).body;
    expect(taste.genres.find((g: { key: string }) => g.key === 'crime').declaredScore).toBeGreaterThan(0.5);

    const { items } = await importTxt(user);
    // D-23: a nota automática sobe com o gosto declarado (Crime/Drama) e o favorito parecido
    const heron = (await get(user, `/library/${items.find((i) => i.title.title === 'Back Heron')!.title.id}`).expect(200)).body;
    expect(heron.autoRating).toBeGreaterThan(3.4);

    await put(user, '/profile/summary', { summary: 'x'.repeat(2001) }).expect(400);
    const cleared = (await put(user, '/profile/summary', { summary: '' }).expect(200)).body;
    expect(cleared.summary).toBeNull();
  });
});

describe('RF-44: rascunho de prioridade', () => {
  it('gera sem mexer na fila, edita, aplica (1..N) e desfaz', async () => {
    const user = await newUser();
    await seedDemo(db, user.userId);
    await put(user, '/profile/summary', { summary: 'gosto de comédia, não gosto de drama' }).expect(200);
    const before = await queue(user);

    const draft = (await post(user, '/library/priority-draft', { scope: 'to_watch' }).expect(201)).body;
    expect(draft.items).toHaveLength(before.length);
    expect(draft.stale).toBe(false);
    expect(draft.items.map((i: { proposedRank: number }) => i.proposedRank)).toEqual(before.map((_, i) => i + 1));
    expect(draft.items.every((i: { reason: string }) => typeof i.reason === 'string' && i.reason.length > 0)).toBe(true);
    expect((await queue(user)).map((t) => t.id)).toEqual(before.map((t) => t.id));

    const last = draft.items[draft.items.length - 1].title.id;
    const moved = (await patch(user, '/library/priority-draft', { id: last, move: { to: 'top' } }).expect(200)).body;
    expect(moved.items[0].title.id).toBe(last);
    expect(moved.items[0].reason).toBe('Você moveu este título');
    await patch(user, '/library/priority-draft', { titleIds: [last] }).expect(400);

    const applied = (await post(user, '/library/priority-draft/apply').expect(200)).body;
    expect(applied.undoToken).toEqual(expect.any(String));
    const after = await queue(user);
    expect(after.map((t) => t.id)).toEqual(moved.items.map((i: { title: { id: string } }) => i.title.id));
    expect(after.map((t) => t.rank)).toEqual(after.map((_, i) => i + 1));
    await get(user, '/library/priority-draft').expect(404);

    await post(user, '/library/bulk/undo', { undoToken: applied.undoToken }).expect(200);
    expect((await queue(user)).map((t) => t.id)).toEqual(before.map((t) => t.id));
  });

  it('fila mudou: GET avisa, apply sem reconciliar = 409, com append_new mantém o novo no fim', async () => {
    const user = await newUser();
    await seedDemo(db, user.userId);
    await post(user, '/library/priority-draft').expect(201);
    const created = (await post(user, '/library', { title: 'Filme Novo Depois do Rascunho', kind: 'movie' }).expect(201)).body;
    const stale = (await get(user, '/library/priority-draft').expect(200)).body;
    expect(stale).toMatchObject({ stale: true, staleDetails: { added: 1, removed: 0 } });
    const conflict = await post(user, '/library/priority-draft/apply').expect(409);
    expect(conflict.body.staleDetails).toEqual({ added: 1, removed: 0 });
    await post(user, '/library/priority-draft/apply', { reconcile: 'append_new' }).expect(200);
    const q = await queue(user);
    expect(q[q.length - 1]!.id).toBe(created.id);
    expect(q.map((t) => t.rank)).toEqual(q.map((_, i) => i + 1));

    await post(user, '/library/priority-draft').expect(201);
    await del(user, '/library/priority-draft').expect(204);
    await del(user, '/library/priority-draft').expect(404);
  });
});

describe('RF-46: busca e importação', () => {
  it('título com ano: homônimo de outro ano fica atrás; marca o que já está na lista', async () => {
    const user = await newUser();
    const res = (await get(user, '/search/titles?q=Monstra%202022').expect(200)).body;
    expect(res.interpreted).toMatchObject({ type: 'title', year: 2022, aiUsed: false });
    expect(res.items.map((i: { tmdbId: number }) => i.tmdbId)).toEqual([9910017, 9910117]);
    expect(res.items[0]).toMatchObject({ kind: 'series', year: 2022, inLibrary: null, matchedBy: 'title', cast: [] });

    const imported = (await post(user, '/library/import', { items: [{ tmdbId: 9910017, mediaType: 'tv' }] }).expect(200)).body;
    expect(imported.created[0]).toMatchObject({ decision: 'cataloged', status: 'to_watch', rank: 1, kind: 'series' });
    const again = (await get(user, '/search/titles?q=Monstra%202022').expect(200)).body;
    expect(again.items[0].inLibrary).toMatchObject({ id: imported.created[0].id, rank: 1, decision: 'cataloged' });

    const dup = (await post(user, '/library/import', { items: [{ tmdbId: 9910017, mediaType: 'tv' }] }).expect(200)).body;
    expect(dup.skipped).toEqual([{ tmdbId: 9910017, mediaType: 'tv', reason: 'already_in_list', existingId: imported.created[0].id }]);
    const now = (await post(user, '/library/import', { items: [{ tmdbId: 9910010, mediaType: 'tv' }], approveNow: true }).expect(200)).body;
    expect(now.created[0]).toMatchObject({ decision: 'cataloged', status: 'to_watch', rank: 2, title: 'Black Heron' });
    await post(user, '/library/import', { items: [{ tmdbId: 9910016, mediaType: 'tv' }], listId: randomUUID() }).expect(400);
  });

  it('pessoa, gênero e descrição (IA só com liberação + consentimento; só o texto digitado vai ao LLM)', async () => {
    const user = await newUser();
    const routes: Record<string, unknown> = {
      '/search/multi?Pessoa Teste': { results: [{ id: 77, media_type: 'person', name: 'Pessoa Teste', popularity: 9 }] },
      '/person/77/combined_credits': {
        cast: [
          { id: 1, media_type: 'movie', title: 'Filme da Pessoa', release_date: '2020-01-01', popularity: 5 },
          { id: 2, media_type: 'tv', name: 'Série da Pessoa', first_air_date: '2018-01-01', popularity: 8 },
        ],
      },
      '/discover/movie': { results: [{ id: 3, title: 'Terror Oitentista', release_date: '1984-01-01', popularity: 3 }] },
      '/discover/tv': { results: [] },
      '/search/multi?Relógio Infinito': { results: [{ id: 4, media_type: 'movie', title: 'Relógio Infinito', release_date: '1993-01-01' }] },
      '/movie/1': { id: 1, credits: { cast: [{ name: 'Pessoa Teste', order: 0 }, { name: 'Outra Pessoa', order: 1 }] } },
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const key = Object.keys(routes).find((k) => {
        const [path, query] = k.split('?');
        return url.pathname.endsWith(path!) && (!query || url.searchParams.get('query') === query);
      });
      return new Response(JSON.stringify(key ? routes[key] : { results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const seen: string[] = [];
    const guesser: TitleGuesser = {
      guess: async (input) => {
        seen.push(input.userText);
        return [{ title: 'Relógio Infinito', year: 1993, kind: 'movie' }];
      },
    };
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), new TmdbResolver('k'.repeat(32), fetchImpl), guesser);

    const person = await search.search(user.userId, 'Pessoa Teste');
    expect(person.interpreted).toMatchObject({ type: 'person', person: 'Pessoa Teste' });
    expect(person.items.map((i) => [i.title, i.matchedBy])).toEqual([
      ['Série da Pessoa', 'person'],
      ['Filme da Pessoa', 'person'],
    ]);
    expect(person.items[1]!.cast).toEqual(['Pessoa Teste', 'Outra Pessoa']);

    const genre = await search.search(user.userId, 'terror anos 80');
    expect(genre.interpreted).toMatchObject({ type: 'genre', decade: 1980, genres: [{ key: 'horror', label: 'Terror' }] });
    expect(genre.items.map((i) => i.title)).toEqual(['Terror Oitentista']);

    const description = 'aquele filme do relojoeiro que fica preso no mesmo dia para sempre';
    const noConsent = await search.search(user.userId, description);
    expect(noConsent.interpreted).toMatchObject({ type: 'description', aiUsed: false });
    expect(seen).toEqual([]);
    await setUserSettings(db, user.userId, { aiConsent: true });
    const withAi = await search.search(user.userId, description);
    expect(withAi.interpreted.aiUsed).toBe(true);
    expect(withAi.items.map((i) => i.title)).toEqual(['Relógio Infinito']);
    // ARB-REQ-06: o LLM recebeu só o texto digitado
    expect(seen).toEqual([description]);

    // pedido curto por critérios: sem IA vira gênero + recência; com "Buscar com IA", vai inteiro para a IA
    const recentWestern = await search.search(user.userId, 'Filme recente de faroeste');
    expect(recentWestern.interpreted).toMatchObject({ type: 'genre', genres: [{ key: 'western', label: 'Faroeste' }] });
    const forced = await search.search(user.userId, 'Filme recente de faroeste', undefined, true);
    expect(forced.interpreted).toMatchObject({ type: 'description', aiUsed: true });
    expect(seen.at(-1)).toBe('Filme recente de faroeste');
  });

  it('D-24: IA acha títulos numa descrição ou no texto de um print; o TMDB confirma, o resto vai para notFound', async () => {
    const user = await newUser();
    const routes: Record<string, unknown> = {
      'Fresh': { results: [{ id: 11, media_type: 'movie', title: 'Fresh', release_date: '2022-03-04', popularity: 20 }] },
      'Frailty': { results: [{ id: 12, media_type: 'movie', title: 'A Mão do Diabo', original_title: 'Frailty', release_date: '2001-04-12', popularity: 9 }] },
      'Relógio Infinito': { results: [{ id: 4, media_type: 'movie', title: 'Relógio Infinito', release_date: '1993-01-01', popularity: 5 }] },
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const body = url.pathname.endsWith('/search/multi') ? (routes[url.searchParams.get('query') ?? ''] ?? { results: [] }) : { results: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const seen: { mode: string; text: string }[] = [];
    const finder = (ocrAllowed: boolean): AiTitleFinder => ({
      ocrAllowed,
      find: async (mode, input) => {
        seen.push({ mode, text: input.userText });
        return mode === 'ocr'
          ? { ok: true, titles: [{ title: 'Fresh', kind: 'movie' }, { title: 'Frailty', kind: 'movie' }, { title: 'Filme Que Não Existe', kind: 'movie' }, { title: 'Um Livro', kind: 'book' }] }
          : { ok: true, titles: [{ title: 'Relógio Infinito', kind: 'movie', year: 1993, reason: 'preso no mesmo dia' }] };
      },
    });
    const make = (f: AiTitleFinder | null) =>
      new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), new TmdbResolver('k'.repeat(32), fetchImpl), null, null, f);
    const ocrText = '[Fresh, Frailty, Sebastian Stan, Netflix, Thriller]';

    expect(await make(null).aiFind(user.userId, { mode: 'describe', text: 'filme do relojoeiro' })).toEqual({ aiUsed: false, unavailable: 'disabled', items: [], notFound: [] });
    expect((await make(finder(false)).aiFind(user.userId, { mode: 'ocr', text: ocrText })).unavailable).toBe('ocr_not_allowed');
    expect((await make(finder(true)).aiFind(user.userId, { mode: 'describe', text: 'filme do relojoeiro' })).unavailable).toBe('consent');
    expect(seen).toEqual([]);

    await setUserSettings(db, user.userId, { aiConsent: true });
    const described = await make(finder(true)).aiFind(user.userId, { mode: 'describe', text: 'filme do relojoeiro' });
    expect(described.aiUsed).toBe(true);
    expect(described.items.map((i) => [i.title, i.matchedBy, i.aiReason])).toEqual([['Relógio Infinito', 'description', 'preso no mesmo dia']]);

    const ocr = await make(finder(true)).aiFind(user.userId, { mode: 'ocr', text: ocrText });
    expect(ocr.items.map((i) => [i.title, i.matchedBy])).toEqual([
      ['Fresh', 'title'],
      ['A Mão do Diabo', 'title'],
    ]);
    expect(ocr.notFound).toEqual([
      { title: 'Filme Que Não Existe', kind: 'movie' },
      { title: 'Um Livro', kind: 'book' },
    ]);
    // ARB-REQ-06: o LLM recebeu só o texto
    expect(seen).toEqual([
      { mode: 'describe', text: 'filme do relojoeiro' },
      { mode: 'ocr', text: ocrText },
    ]);

    // HTTP: contrato validado; no ambiente de teste a IA está desligada
    const res = await post(user, '/search/ai', { mode: 'describe', text: 'filme do relojoeiro' }).expect(200);
    expect(res.body).toEqual({ aiUsed: false, unavailable: 'disabled', items: [], notFound: [] });
    await post(user, '/search/ai', { mode: 'describe', text: 'x'.repeat(1001) }).expect(400);
    await post(user, '/search/ai', { mode: 'ocr', text: 'x'.repeat(1001) }).expect(200);
  });

  it('D-25: "assistir hoje" — Minha Área primeiro, plano do pedido, descobertas nos streamings, sessão sem repetir, IA só interpreta', async () => {
    const user = await newUser();
    type M = { title: string; original?: string; date: string; providers?: string[]; genres?: number[]; lang?: string; votes?: number };
    const movies: Record<number, M> = {
      11: { title: 'Fresh', date: '2022-03-04', providers: ['Disney Plus'], genres: [27] },
      13: { title: 'Prisioneiros', date: '2013-09-20', providers: ['Netflix'], genres: [80, 53] },
      14: { title: 'Ilha do Medo', date: '2010-02-19', providers: ['Netflix'], genres: [53] },
      15: { title: 'Zodíaco', date: '2007-03-02', genres: [80] },
      16: { title: 'Duna', date: '2021-09-15', providers: ['Max'], genres: [28, 878] },
      17: { title: 'Matrix', date: '1999-03-31', providers: ['Netflix'], genres: [28, 878], votes: 26000 },
      18: { title: 'A Origem', date: '2010-07-16', providers: ['Netflix'], genres: [28, 878], votes: 36000 },
      19: { title: 'Tenet', date: '2020-08-26', providers: ['Netflix'], genres: [28, 878] },
      20: { title: 'Só no Cinema', date: '2019-01-01', providers: [], genres: [28, 878] },
      21: { title: 'Duna: Parte 2', date: '2024-02-28', providers: ['Netflix'], genres: [28, 878] },
      30: { title: 'Akira', date: '1988-07-16', providers: ['Netflix'], genres: [16, 28, 878], lang: 'ja' },
      40: { title: 'Ex Machina', date: '2015-01-21', providers: ['Netflix'], genres: [878, 28] },
      41: { title: 'Batman Animado', date: '2012-09-25', providers: ['Netflix'], genres: [16, 28, 878], lang: 'en' },
    };
    const urls: URL[] = [];
    const hit = (id: number) => ({
      id,
      media_type: 'movie',
      title: movies[id]!.title,
      original_title: movies[id]!.original ?? movies[id]!.title,
      release_date: movies[id]!.date,
      popularity: 10,
      genre_ids: movies[id]!.genres ?? [],
      vote_average: 8,
      vote_count: movies[id]!.votes ?? 5000,
      ...(movies[id]!.lang ? { original_language: movies[id]!.lang } : {}),
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      urls.push(url);
      const q = url.searchParams;
      let body: unknown = { results: [] };
      if (url.pathname.endsWith('/search/keyword')) {
        const ids: Record<string, number> = { philosophy: 490, 'artificial intelligence (a.i.)': 310 };
        const id = ids[q.get('query') ?? ''];
        if (id) body = { results: [{ id, name: q.get('query') }] };
      } else if (url.pathname.endsWith('/search/multi')) {
        const id = Object.entries(movies).find(([, m]) => m.title === q.get('query'))?.[0];
        if (id) body = { results: [hit(Number(id))] };
      } else if (url.pathname.endsWith('/discover/movie')) {
        const page = q.get('page') ?? '1';
        const genres = q.get('with_genres');
        const pick = (ids: number[]) => ({ results: page === '1' ? ids.map(hit) : [] });
        if (genres === '28,878' && q.get('with_keywords')) body = pick([18, 40]);
        else if (genres === '28,878' && q.get('sort_by')?.startsWith('primary_release_date')) body = pick([21]);
        else if (genres === '28,878') body = pick([17, 30, 41, 15, 20]);
        else if (!genres && !q.get('with_keywords')) body = pick([11, 14]);
      } else {
        const one = /\/movie\/(\d+)$/.exec(url.pathname);
        const m = one ? movies[Number(one[1])] : undefined;
        if (m)
          body = {
            ...hit(Number(one![1])),
            genres: (m.genres ?? []).map((id) => ({ id })),
            'watch/providers': { results: { BR: { flatrate: (m.providers ?? []).map((provider_name, i) => ({ provider_name, provider_id: i + 1 })) } } },
          };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const planCalls: string[] = [];
    const genCalls: TasteBrief[] = [];
    const ai: TasteAi = {
      improveSummary: async (text) => ({ ok: true, value: `Melhorado: ${text}` }),
      planRequest: async (text) => {
        planCalls.push(text);
        return { ok: true, value: { genresAll: ['scifi'], genresAny: [], genresNone: ['horror'], prefer: ['thought_provoking'], avoid: [], unmapped: [] } };
      },
      tonight: async (brief, _userId, kind) => {
        genCalls.push(brief);
        if (kind === 'music') return { ok: true, value: { picks: [{ title: 'Construção', kind: 'music_track', creator: 'Chico Buarque', reason: 'MPB densa' }], request: 'pedido' } };
        return { ok: true, value: { picks: [{ title: 'Tenet', kind: 'movie', year: 2020 }, { title: 'Inexistente', kind: 'movie' }], request: 'pedido' } };
      },
    };
    const tmdb = new TmdbResolver('k'.repeat(32), fetchImpl);
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), tmdb, null);
    // o teste faz mais pedidos por minuto do que o limite padrão
    process.env.TONIGHT_RATE_LIMIT_PER_MIN = '100';
    const tonight = new TonightService(db, search, ctx.app.get(LibraryService), ctx.app.get(CatalogService), ai, tmdb);
    delete process.env.TONIGHT_RATE_LIMIT_PER_MIN;
    const session = () => randomUUID();

    // RNF-07: pedido com risco não busca nada e traz o CVV
    const risky = await tonight.tonight(user.userId, { mood: 'não aguento mais, quero sumir e me matar' });
    expect(risky.items).toEqual([]);
    expect(risky.risk?.cvvPhone).toBeTruthy();

    // perfil: Netflix assinada, favorito (Ilha do Medo), assistido (Zodíaco), na Minha Área: Duna (Max) e Prisioneiros
    await put(user, '/profile/subscriptions', { providers: ['netflix'] }).expect(200);
    await post(user, '/profile/favorites', { title: 'Ilha do Medo', kind: 'movie', year: 2010, tmdbId: 14, mediaType: 'movie', rating: 5 }).expect(201);
    await tonight.markWatched(user.userId, { tmdbId: 15, mediaType: 'movie' });
    await search.import(user.userId, { items: [{ tmdbId: 16, mediaType: 'movie' }, { tmdbId: 13, mediaType: 'movie' }] });

    // sem consentimento: sem IA, mas o pedido simples é entendido localmente e a busca roda
    const s1 = session();
    const local = await tonight.tonight(user.userId, { sessionId: s1, kind: 'movie', mood: 'um bom filme de ação, mas que seja scifi e inteligente' });
    expect(local.unavailable).toBe('consent');
    expect(local.understood).toBe('Ação + Ficção científica · faz pensar');
    expect(planCalls).toEqual([]);
    // 1º a Minha Área (Duna, mesmo fora dos streamings), depois descobertas: tema (palavra-chave), mais bem
    // avaliados, recentes — só na Netflix, sem anime, sem assistido/favorito, sem o que não atende ao pedido
    expect(local.items.map((i) => i.title)).toEqual(['Duna', 'A Origem', 'Ex Machina', 'Matrix']);
    expect(local.items[0]).toMatchObject({ fromList: true, availableOn: ['Max'], aiReason: expect.stringMatching(/^Na sua lista · ação e ficção científica/) });
    expect(local.items[1]).toMatchObject({ availableOn: ['Netflix'], aiReason: expect.stringMatching(/^Ação e ficção científica · tema: faz pensar · nota 8,0 no TMDB/) });
    // as palavras-chave vêm resolvidas pelo nome (sem inventar IDs) e os gêneros, todos ao mesmo tempo
    const themed = urls.find((u) => u.pathname.endsWith('/discover/movie') && u.searchParams.get('with_keywords'))!;
    expect(themed.searchParams.get('with_keywords')).toBe('490|310');
    expect(themed.searchParams.get('with_genres')).toBe('28,878');
    expect(themed.searchParams.get('with_watch_providers')).toBe('8');
    // sem "Incluir animes e animações": animação fica de fora já na busca (e no filtro, se vier)
    expect(themed.searchParams.get('without_genres')).toBe('16');
    expect(local.items.map((i) => i.title)).not.toContain('Batman Animado');

    // mesma sessão: "novas sugestões" não repetem; acabou o que há com estes filtros → esgotado (sem IA aqui)
    const more = await tonight.tonight(user.userId, { sessionId: s1, kind: 'movie', mood: 'um bom filme de ação, mas que seja scifi e inteligente' });
    // um título por franquia no lote: "Duna: Parte 2" ficou para cá (junto com "Duna" não vinha)
    expect(more.items.map((i) => i.title)).toEqual(['Duna: Parte 2']);
    const last = await tonight.tonight(user.userId, { sessionId: s1, kind: 'movie', mood: 'um bom filme de ação, mas que seja scifi e inteligente' });
    expect(last.items).toEqual([]);
    expect(last.exhausted).toBe(true);

    // com IA: só interpreta o que o parser não entendeu (sem histórico, sem catálogo) e completa com nomes uma vez
    await setUserSettings(db, user.userId, { aiConsent: true });
    const s2 = session();
    const noir = await tonight.tonight(user.userId, { sessionId: s2, kind: 'movie', mood: 'algo noir cyberpunk sem terror' });
    expect(planCalls).toEqual(['algo noir cyberpunk sem terror']);
    expect(noir.aiUsed).toBe(true);
    expect(noir.understood).toBe('Ficção científica · faz pensar · sem terror');
    // gerador: só como complemento, sem motivo da IA (o motivo vem das evidências); "Inexistente" não se confirma
    expect(genCalls).toHaveLength(1);
    // amostra do que já viu só dos gêneros da busca (Zodíaco é crime: fica de fora); o total vai à parte
    expect(genCalls[0]!.seen).toEqual([]);
    expect(genCalls[0]!.seenCount).toBe(1);
    expect(noir.items.find((i) => i.title === 'Tenet')?.aiReason).toMatch(/^Sugestão da IA para o seu pedido/);

    // "Incluir animes?" traz o Akira; "Só novidades" (sem a Minha Área) não traz Duna
    const anime = await tonight.tonight(user.userId, { sessionId: session(), kind: 'movie', mood: 'ação e scifi', includeAnime: true, includeQueue: false });
    expect(anime.items.map((i) => i.title)).toEqual(expect.arrayContaining(['Akira', 'Batman Animado']));
    expect(anime.items.map((i) => i.title)).not.toContain('Duna');
    // "Qualquer lugar": não filtra por streaming e mostra onde está
    const anywhere = await tonight.tonight(user.userId, { sessionId: session(), kind: 'movie', mood: 'ação e scifi', services: [] });
    expect(anywhere.items.find((i) => i.title === 'Só no Cinema')).toMatchObject({ availableOn: [] });

    // "já assisti" grava e o título sai de todas as sessões
    const s3 = session();
    const first = await tonight.tonight(user.userId, { sessionId: s3, kind: 'movie', mood: 'ação e scifi' });
    expect(first.items[0]!.title).toBe('Duna');
    const watched = await tonight.markWatched(user.userId, { tmdbId: 16, mediaType: 'movie' });
    expect(watched.status).toBe('watched');
    const again = await tonight.tonight(user.userId, { sessionId: session(), kind: 'movie', mood: 'ação e scifi' });
    expect(again.items.map((i) => i.title)).not.toContain('Duna');

    // já visto não volta; com "Incluir já vistos", volta
    await tonight.markWatched(user.userId, { tmdbId: 17, mediaType: 'movie' });
    expect((await tonight.tonight(user.userId, { sessionId: session(), kind: 'movie', mood: 'ação e scifi' })).items.map((i) => i.title)).not.toContain('Matrix');
    expect((await tonight.tonight(user.userId, { sessionId: session(), kind: 'movie', mood: 'ação e scifi', includeSeen: true })).items.map((i) => i.title)).toContain('Matrix');

    // música: sugestão da IA (sem conferência); "já ouvi" entra na lista
    const music = await tonight.tonight(user.userId, { kind: 'music', genre: 'MPB' });
    expect(music.music).toEqual([{ key: 'music:construcao-chico-buarque', title: 'Construção', artist: 'Chico Buarque', kind: 'music_track', aiReason: 'MPB densa' }]);
    const heard = await tonight.markWatched(user.userId, { music: { title: 'Construção', artist: 'Chico Buarque', kind: 'music_track' } });
    expect(heard).toMatchObject({ title: 'Construção', status: 'watched' });

    // resumo sugerido (local) e melhorado; padrões do painel
    expect((await tonight.suggestSummary(user.userId)).summary).toContain('Ilha do Medo (2010)');
    expect(await tonight.improveSummary(user.userId, 'adoro suspense')).toEqual({ summary: 'Melhorado: adoro suspense', aiUsed: true });
    const defaults = await tonight.defaults(user.userId);
    expect(defaults.services.find((x) => x.key === 'netflix')).toEqual({ key: 'netflix', label: 'Netflix', selected: true });

    // HTTP: contrato; no ambiente de teste a IA está desligada (busca local roda)
    expect((await post(user, '/tonight', {}).expect(200)).body).toMatchObject({ aiUsed: false, unavailable: 'disabled', services: ['Netflix'] });
    expect((await get(user, '/tonight/defaults').expect(200)).body.genres.length).toBeGreaterThan(0);
    expect((await get(user, '/profile/summary/suggestion').expect(200)).body.summary).toContain('Ilha do Medo');
    await post(user, '/tonight', { exclude: ['nope'] }).expect(400);
    await post(user, '/tonight', { sessionId: 'nope' }).expect(400);
    await post(user, '/tonight', { kind: 'podcast' }).expect(400);
    await post(user, '/tonight/watched', { tmdbId: -1, mediaType: 'movie' }).expect(400);
  });

  it('link do TMDB colado na busca traz o título exato (filme ou série), pronto para incluir', async () => {
    const user = await newUser();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const body = url.pathname.endsWith('/tv/276161')
        ? { id: 276161, name: 'Série do Link', first_air_date: '2025-05-01', genres: [{ id: 18 }], vote_average: 7.9, vote_count: 900 }
        : url.pathname.endsWith('/movie/603')
          ? { id: 603, title: 'Matrix', release_date: '1999-03-31', genres: [{ id: 28 }, { id: 878 }] }
          : { results: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), new TmdbResolver('k'.repeat(32), fetchImpl), null);
    const tv = await search.search(user.userId, 'https://www.themoviedb.org/tv/276161');
    expect(tv.items).toHaveLength(1);
    expect(tv.items[0]).toMatchObject({ tmdbId: 276161, mediaType: 'tv', kind: 'series', title: 'Série do Link', year: 2025 });
    const movie = await search.search(user.userId, 'themoviedb.org/movie/603-the-matrix?language=pt-BR');
    expect(movie.items[0]).toMatchObject({ tmdbId: 603, mediaType: 'movie', title: 'Matrix' });
    // e entra na lista como qualquer resultado da busca
    const imported = await search.import(user.userId, { items: [{ tmdbId: 276161, mediaType: 'tv' }] });
    expect(imported.created[0]).toMatchObject({ title: 'Série do Link', status: 'to_watch' });
    // outro site não é tratado como link do TMDB
    expect((await search.search(user.userId, 'https://www.imdb.com/title/tt0133093/')).items.every((i) => i.tmdbId !== 603)).toBe(true);
  });

  it('D-23: "melhor" e lançamentos viram /discover ao vivo (serviço no Brasil, pessoa, minissérie, datas)', async () => {
    const user = await newUser();
    const urls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      urls.push(url);
      let body: unknown = { results: [] };
      if (url.pathname.endsWith('/search/person')) body = { results: [{ id: 6384, name: 'Keanu Reeves', popularity: 50 }] };
      if (url.pathname.endsWith('/discover/movie'))
        body = { results: [{ id: 603, title: 'Matrix', release_date: '1999-03-31', popularity: 80, vote_average: 8.2, vote_count: 26000 }] };
      if (url.pathname.endsWith('/discover/tv'))
        body = { results: [{ id: 1, name: 'Minissérie Boa', first_air_date: '2020-01-01', popularity: 10, vote_average: 8.6, vote_count: 900 }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), new TmdbResolver('k'.repeat(32), fetchImpl), null);
    const discover = (kind: 'movie' | 'tv') => urls.filter((u) => u.pathname.endsWith(`/discover/${kind}`)).at(-1)!.searchParams;

    const keanu = await search.search(user.userId, 'melhor filme do keanu reeves na hbo');
    expect(keanu.interpreted).toMatchObject({ type: 'browse', person: 'Keanu Reeves', labels: ['mais bem avaliados', 'filme', 'Max'] });
    expect(keanu.items[0]).toMatchObject({ title: 'Matrix', matchedBy: 'browse', generalRating: 8.2, generalVotes: 26000 });
    const m = discover('movie');
    expect(m.get('sort_by')).toBe('vote_average.desc');
    expect(m.get('with_people')).toBe('6384');
    expect(m.get('with_watch_providers')).toBe('1899|384');
    expect(m.get('watch_region')).toBe('BR');

    const mini = await search.search(user.userId, 'melhor miniserie de suspense da netflix');
    expect(mini.items.map((i) => i.title)).toEqual(['Minissérie Boa']);
    const t = discover('tv');
    expect(t.get('with_type')).toBe('2');
    expect(t.get('with_watch_providers')).toBe('8');
    expect(t.get('with_genres')).toBeTruthy();
    expect(Number(t.get('vote_count.gte'))).toBeGreaterThan(0);

    await search.search(user.userId, 'filmes em breve');
    const soon = discover('movie');
    expect(soon.get('sort_by')).toBe('popularity.desc');
    expect(soon.get('primary_release_date.gte')! > new Date().toISOString().slice(0, 10)).toBe(true);

    // o que sobra e não é pessoa: segue a busca normal por título
    urls.length = 0;
    const title = await search.search(user.userId, 'O Melhor Amigo');
    expect(title.interpreted.type).not.toBe('browse');
  });

  it('D-23: categoria sugerida pelo TMDB para os títulos de um import (Filme/Série; sem match = null)', async () => {
    const user = await newUser();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const q = url.searchParams.get('query');
      const results =
        q === 'Série Boa'
          ? [{ id: 1, media_type: 'tv', name: 'Série Boa', first_air_date: '2020-01-01', popularity: 5 }]
          : q === 'Filme Bom'
            ? [
                { id: 2, media_type: 'movie', title: 'Filme Bom', release_date: '2019-01-01', popularity: 5 },
                { id: 3, media_type: 'tv', name: 'Filme Bom: a série', first_air_date: '2022-01-01', popularity: 9 },
              ]
            : [];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const search = new SearchService(db, ctx.app.get(ReviewService), ctx.app.get(LibraryService), new TmdbResolver('k'.repeat(32), fetchImpl), null);
    const r = await search.classify(user.userId, ['Série Boa', 'Filme Bom', 'Nada Parecido']);
    expect(r.items).toEqual([
      { title: 'Série Boa', kind: 'series', tmdbTitle: 'Série Boa', year: 2020 },
      { title: 'Filme Bom', kind: 'movie', tmdbTitle: 'Filme Bom', year: 2019 },
      { title: 'Nada Parecido', kind: null },
    ]);
    await post(user, '/search/classify', { titles: [] }).expect(400);
  });

  it('sem liberação do TMDB para IA, o guesser nem existe; limite por usuário responde 429', async () => {
    const { createTitleGuesser } = await import('../../src/library/title-guesser.js');
    const { testEnv } = await import('../helpers.js');
    expect(createTitleGuesser(testEnv({ AI_MODE: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }))).toBeNull();
    expect(createTitleGuesser(testEnv({ AI_MODE: 'rules' }))).toBeNull();

    const user = await newUser();
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await get(user, '/search/titles?q=Monstra')).status;
    expect(last).toBe(429);
  });
});

describe('Música "Música - Artista"', () => {
  async function importText(user: User, name: string, content: string) {
    const res = await post(user, '/shares', { clientShareId: randomUUID(), textFile: { name, content } }).expect(201);
    await processor.process({ shareId: res.body.id, userId: user.userId });
    const items = (await get(user, '/library?area=1&sort=rank').expect(200)).body.items;
    return items as { id: string; title: string; creator?: string; kind: string }[];
  }

  it('"Músicas:" lê "Aquarela - Toquinho" como título Aquarela, artista Toquinho', async () => {
    const user = await newUser();
    const items = await importText(user, 'musicas.txt', 'Músicas:\nAquarela - Toquinho\nÁguas de Março - Tom Jobim');
    expect(items.map((i) => [i.kind, i.title, i.creator])).toEqual([
      ['music_track', 'Aquarela', 'Toquinho'],
      ['music_track', 'Águas de Março', 'Tom Jobim'],
    ]);
  });

});
});
