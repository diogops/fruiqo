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
  const items = (await get(user, '/review').expect(200)).body.items as ReviewItemBody[];
  return { shareId: res.body.id as string, items };
}

async function queue(user: User) {
  const body = (await get(user, '/library?limit=100&sort=rank').expect(200)).body;
  return (body.items as { id: string; title: string; rank: number }[]).filter((t) => t.rank != null).sort((a, b) => a.rank - b.rank);
}

describe('RF-47 + RF-42: .txt vai inteiro para a revisão, com match, alternativas e lista proposta', () => {
  it('17 itens na ordem do arquivo, nenhum catalogado; erro de digitação e homônimo resolvidos', async () => {
    const user = await newUser();
    const { shareId, items } = await importTxt(user);
    expect(items).toHaveLength(17);
    expect(items.map((i) => i.title.title).slice(0, 3)).toEqual(['Bebe Lontra', 'Olhos que julgam', 'Chernoville']);
    expect(items.every((i) => i.title.decision === 'review_queue' && i.title.rank === null)).toBe(true);
    expect(items.every((i) => i.title.resolution?.externalId.startsWith('tv:'))).toBe(true);

    const heron = items.find((i) => i.title.title === 'Back Heron')!;
    expect(heron.title.resolution).toMatchObject({ externalId: 'tv:9910010', title: 'Black Heron' });
    expect(heron.alternatives.map((a) => a.tmdbId)).toEqual([9910110]);
    const monstra = items.find((i) => i.title.title === 'Monstra')!;
    expect(monstra.title.resolution?.externalId).toBe('tv:9910017');
    expect(monstra.alternatives[0]).toMatchObject({ tmdbId: 9910117, year: 2026 });
    expect(monstra.alternatives[0]!.score).toBeLessThanOrEqual(0.55);
    expect(monstra.title.suggestedDecision).toBe('cataloged');

    expect(items[0]!.proposedList).toEqual({ name: 'lista series', shareId, listId: null });
    expect(items[0]!.fit).toMatchObject({ position: 1, total: 1 });
    // nada entrou em lista nem na fila
    expect((await get(user, '/lists').expect(200)).body).toHaveLength(0);
    expect(await queue(user)).toHaveLength(0);
  });

  it('aprovar ajusta match (alternativa), posição e listas; rejeitar e lote', async () => {
    const user = await newUser();
    const { items } = await importTxt(user);
    const byTitle = (t: string) => items.find((i) => i.title.title === t)!.title.id;

    // trocar o match pela alternativa: título/ano/resolução do catálogo
    const alt = await post(user, `/review/${byTitle('Monstra')}/approve`, { alternative: { tmdbId: 9910117, mediaType: 'tv' }, placement: 'end' }).expect(200);
    expect(alt.body).toMatchObject({ title: 'Monstra', year: 2026, decision: 'cataloged', rank: 1 });
    expect(alt.body.resolution.externalId).toBe('tv:9910117');

    const top = await post(user, `/review/${byTitle('Mindcatcher')}/approve`, { placement: 'top' }).expect(200);
    expect(top.body.rank).toBe(1);
    const own = (await post(user, '/lists', { name: 'Minha lista' }).expect(201)).body;
    const at = await post(user, `/review/${byTitle('Criada')}/approve`, { position: 2, listIds: [own.id], title: 'Criada (minissérie)' }).expect(200);
    expect(at.body).toMatchObject({ rank: 2, title: 'Criada (minissérie)' });
    expect(at.body.lists.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(['Minha lista', 'lista series']));

    await post(user, `/review/${byTitle('O pacto')}/reject`).expect(204);
    const batch = await post(user, '/review/batch', { ids: [byTitle('Chernoville'), byTitle('O pacto'), byTitle('Amor e Luto')], action: 'approve', placement: 'end' }).expect(200);
    expect(batch.body.approved.map((t: { title: string }) => t.title)).toEqual(['Chernoville', 'Amor e Luto']);
    expect(batch.body.failed).toEqual([{ id: byTitle('O pacto'), message: 'Título não encontrado' }]);

    const q = await queue(user);
    expect(q.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(q.map((t) => t.title)).toEqual(['Mindcatcher', 'Criada (minissérie)', 'Monstra', 'Chernoville', 'Amor e Luto']);
    // a lista proposta respeita a ordem do arquivo
    const list = (await get(user, '/lists').expect(200)).body.find((l: { name: string }) => l.name === 'lista series');
    const detail = (await get(user, `/lists/${list.id}`).expect(200)).body;
    expect(detail.items.map((t: { title: string }) => t.title)).toEqual(['Chernoville', 'Criada (minissérie)', 'Amor e Luto', 'Mindcatcher', 'Monstra']);

    // restante segue na revisão; a lista agora aparece como criada
    const rest = (await get(user, '/review').expect(200)).body.items as ReviewItemBody[];
    expect(rest).toHaveLength(11);
    expect(rest[0]!.proposedList?.listId).toBe(list.id);
  });

  it('lote com placement top mantém a ordem enviada (#1, #2, #3), acima da fila', async () => {
    const user = await newUser();
    const { items } = await importTxt(user);
    const byTitle = (t: string) => items.find((i) => i.title.title === t)!.title.id;
    await post(user, `/review/${byTitle('Mindcatcher')}/approve`, { placement: 'end' }).expect(200);
    const ids = [byTitle('Monstra'), byTitle('Chernoville'), byTitle('Amor e Luto')];
    await post(user, '/review/batch', { ids, action: 'approve', placement: 'top' }).expect(200);
    const q = await queue(user);
    expect(q.map((t) => t.title)).toEqual(['Monstra', 'Chernoville', 'Amor e Luto', 'Mindcatcher']);
    expect(q.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
  });

  it('duplicado: o mesmo match no TMDB de um título já catalogado sugere mesclar', async () => {
    const user = await newUser();
    const first = await importTxt(user);
    await post(user, `/review/${first.items.find((i) => i.title.title === 'Back Heron')!.title.id}/approve`).expect(200);
    // outra grafia do mesmo título, com o mesmo match
    await withUser(db, user.userId, (tx) =>
      tx.insert(recommendations).values({
        userId: user.userId,
        kind: 'series',
        title: 'Blak Heron',
        confidence: 0.6,
        extractor: 'heuristic',
        dedupKey: 'screen|blak heron',
        decision: 'review_queue',
        resolution: { provider: 'tmdb', externalId: 'tv:9910010', title: 'Black Heron', url: 'https://www.themoviedb.org/tv/9910010' },
      }),
    );
    const items = (await get(user, '/review').expect(200)).body.items as ReviewItemBody[];
    const dup = items.find((i) => i.title.title === 'Blak Heron')!;
    expect(dup.duplicateOf).toMatchObject({ id: expect.any(String) });
  });
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
    const heron = items.find((i) => i.title.title === 'Back Heron')!;
    expect(heron.fit!.reasons).toEqual(expect.arrayContaining(['Você declarou gostar de Crime e Drama']));
    expect(heron.fit!.reasons.some((r) => r.startsWith('Parecido com Mindcatcher'))).toBe(true);
    expect(heron.fit!.score).toBeGreaterThan(0.3);

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
    expect(imported.created[0]).toMatchObject({ decision: 'review_queue', rank: null, kind: 'series' });
    const again = (await get(user, '/search/titles?q=Monstra%202022').expect(200)).body;
    expect(again.items[0].inLibrary).toMatchObject({ id: imported.created[0].id, rank: null, decision: 'review_queue' });

    const dup = (await post(user, '/library/import', { items: [{ tmdbId: 9910017, mediaType: 'tv' }] }).expect(200)).body;
    expect(dup.skipped).toEqual([{ tmdbId: 9910017, mediaType: 'tv', reason: 'already_in_list', existingId: imported.created[0].id }]);
    const now = (await post(user, '/library/import', { items: [{ tmdbId: 9910010, mediaType: 'tv' }], approveNow: true }).expect(200)).body;
    expect(now.created[0]).toMatchObject({ decision: 'cataloged', rank: 1, title: 'Black Heron' });
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

describe('Música "Música - Artista" e troca na revisão', () => {
  async function importText(user: User, name: string, content: string) {
    const res = await post(user, '/shares', { clientShareId: randomUUID(), textFile: { name, content } }).expect(201);
    await processor.process({ shareId: res.body.id, userId: user.userId });
    const items = (await get(user, '/review').expect(200)).body.items as ReviewItemBody[];
    return items.map((i) => i.title as unknown as { id: string; title: string; creator?: string; kind: string });
  }

  it('"Músicas:" lê "Aquarela - Toquinho" como título Aquarela, artista Toquinho; swap-music inverte e mantém na revisão', async () => {
    const user = await newUser();
    const items = await importText(user, 'musicas.txt', 'Músicas:\nAquarela - Toquinho\nÁguas de Março - Tom Jobim');
    expect(items.map((i) => [i.kind, i.title, i.creator])).toEqual([
      ['music_track', 'Aquarela', 'Toquinho'],
      ['music_track', 'Águas de Março', 'Tom Jobim'],
    ]);
    const swapped = (await post(user, `/review/${items[0]!.id}/swap-music`).expect(200)).body;
    expect(swapped).toMatchObject({ title: 'Toquinho', creator: 'Aquarela' });
    const after = (await get(user, '/review').expect(200)).body.items as ReviewItemBody[];
    expect(after.find((i) => i.title.id === items[0]!.id)?.title.title).toBe('Toquinho');
    // desfaz trocando de novo
    expect((await post(user, `/review/${items[0]!.id}/swap-music`).expect(200)).body).toMatchObject({ title: 'Aquarela', creator: 'Toquinho' });
  });

  it('troca que colide com outro item responde 409; item que não é música responde 400', async () => {
    const user = await newUser();
    const items = await importText(user, 'mix.txt', 'Músicas:\nAquarela - Toquinho\nToquinho - Aquarela\nFilmes:\nFilme Um (2020)');
    const reversed = items.find((i) => i.title === 'Toquinho')!;
    await post(user, `/review/${reversed.id}/swap-music`).expect(409);
    const movie = items.find((i) => i.kind === 'movie')!;
    await post(user, `/review/${movie.id}/swap-music`).expect(400);
  });
});
