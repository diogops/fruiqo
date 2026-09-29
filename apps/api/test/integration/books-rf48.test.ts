// RF-48 (D-21): livros pela Open Library — import de .txt com revisão e alternativas, busca por
// título/autor, import da busca e enriquecimento. Gravações sintéticas de fixtures/txt-books-list.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, withUser } from '../../src/db/client.js';
import { HeuristicExtractor } from '../../src/pipeline/extractors/heuristic.js';
import { FIXTURES_DIR, PipelineGateway } from '../../src/pipeline/gateway.js';
import { ShareProcessor } from '../../src/pipeline/process-share.js';
import { OpenLibraryResolver } from '../../src/pipeline/resolvers/openlibrary.js';
import { TmdbResolver } from '../../src/pipeline/resolvers/tmdb.js';
import { APP_URL } from '../helpers.js';
import { register, startTestApp } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const { db, pool } = createDb(APP_URL);
const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: [FIXTURES_DIR] });
const processor = new ShareProcessor({
  db,
  logger: pino({ level: 'silent' }),
  heuristic: new HeuristicExtractor(),
  fetchMetadata: async () => null,
  resolvers: [new TmdbResolver('mock-key', gateway.fetchImpl), new OpenLibraryResolver(undefined, gateway.fetchImpl, false)],
});
const BOOKS_TXT = readFileSync(join(FIXTURES_DIR, 'txt-books-list', 'livros-para-ler.txt'), 'utf8');

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

interface ReviewBookItem {
  title: { id: string; title: string; kind: string; creator?: string | null; posterUrl?: string; bookUrl?: string; pages?: number; overview?: string; genres: { key: string; label: string }[] };
  alternatives: unknown[];
  bookAlternatives?: { olWorkId: string; title: string; authors?: string[]; score: number }[];
}

describe('RF-48: .txt de livros vai para a revisão com match da Open Library', () => {
  it('tipo, autor, capa (só URL), link da obra e alternativas; aprovar com outra obra', async () => {
    const user = await newUser();
    const share = await post(user, '/shares', { clientShareId: randomUUID(), textFile: { name: 'livros para ler.txt', content: BOOKS_TXT } }).expect(201);
    await processor.process({ shareId: share.body.id, userId: user.userId });
    const items = (await get(user, '/review').expect(200)).body.items as ReviewBookItem[];
    expect(items.map((i) => [i.title.kind, i.title.title])).toEqual([
      ['book', 'O Relógio de Areia'],
      ['book', 'Vento Sul'],
      ['book', 'Cartas do Sertão'],
      ['book', 'Nove Estrelas'],
    ]);
    const relogio = items[0]!.title;
    expect(relogio).toMatchObject({
      creator: 'Ana Fictícia',
      posterUrl: 'https://covers.openlibrary.org/b/id/9990001-M.jpg',
      bookUrl: 'https://openlibrary.org/works/OL9990001W',
      pages: 212,
      overview: 'Sinopse fictícia escrita pelo time Fruiqo.',
    });
    expect(items[3]!.title.genres.map((g) => g.key)).toEqual(expect.arrayContaining(['fantasy', 'young_adult']));
    expect(items[3]!.title.genres.find((g) => g.key === 'young_adult')?.label).toBe('Infantojuvenil');

    const vento = items[1]!;
    expect(vento.alternatives).toEqual([]);
    expect(vento.bookAlternatives).toEqual([expect.objectContaining({ olWorkId: 'OL9990003W', title: 'Vento Sul e Outras Histórias' })]);
    expect(vento.bookAlternatives![0]).not.toHaveProperty('provider');

    const approved = (await post(user, `/review/${vento.title.id}/approve`, { alternativeBook: { olWorkId: 'OL9990003W' } }).expect(200)).body;
    expect(approved).toMatchObject({
      kind: 'book',
      title: 'Vento Sul e Outras Histórias',
      creator: 'Autor Inventado',
      decision: 'cataloged',
      bookUrl: 'https://openlibrary.org/works/OL9990003W',
    });
    // alternativa de livro que não estava guardada ainda é buscada por id; id inválido é 400
    await post(user, `/review/${items[2]!.title.id}/approve`, { alternativeBook: { olWorkId: 'nada' } }).expect(400);
  });
});

describe('RF-48: busca e import de livros', () => {
  it('busca por autor (kind=book), marca o que já está na biblioteca e importa para a revisão', async () => {
    const user = await newUser();
    const res = (await get(user, '/search/titles?kind=book&q=Marta%20Quintela').expect(200)).body;
    expect(res.interpreted).toMatchObject({ type: 'person', person: 'Marta Quintela', aiUsed: false });
    expect(res.items).toEqual([]);
    expect(res.books.map((b: { olWorkId: string }) => b.olWorkId)).toEqual(['OL9990002W', 'OL9990007W']);
    expect(res.books[0]).toMatchObject({
      title: 'Vento Sul',
      authors: ['Marta Quintela'],
      url: 'https://openlibrary.org/works/OL9990002W',
      coverUrl: 'https://covers.openlibrary.org/b/id/9990002-M.jpg',
      inLibrary: null,
      matchedBy: 'author',
    });

    const imported = (await post(user, '/library/import', { books: [{ olWorkId: 'OL9990002W' }] }).expect(200)).body;
    expect(imported.created[0]).toMatchObject({ kind: 'book', title: 'Vento Sul', creator: 'Marta Quintela', decision: 'review_queue', rank: null });
    expect(imported.skippedBooks).toEqual([]);
    const again = (await get(user, '/search/titles?kind=book&q=Marta%20Quintela').expect(200)).body;
    expect(again.books[0].inLibrary).toMatchObject({ id: imported.created[0].id, decision: 'review_queue' });

    const dup = (await post(user, '/library/import', { books: [{ olWorkId: 'OL9990002W' }] }).expect(200)).body;
    expect(dup.skippedBooks).toEqual([{ olWorkId: 'OL9990002W', reason: 'already_in_list', existingId: imported.created[0].id }]);
    const now = (await post(user, '/library/import', { books: [{ olWorkId: 'OL9990001W' }], approveNow: true }).expect(200)).body;
    expect(now.created[0]).toMatchObject({ kind: 'book', title: 'O Relógio de Areia', decision: 'cataloged', rank: 1 });
    await post(user, '/library/import', { items: [] }).expect(400);
  });

  it('enriquece um livro cadastrado à mão pela Open Library', async () => {
    const user = await newUser();
    const created = (await post(user, '/library', { title: 'Vento Sul', kind: 'book', creator: 'Marta Quintela' }).expect(201)).body;
    const res = (await post(user, `/library/${created.id}/enrich`).expect(200)).body;
    expect(res.status).toBe('enriched');
    expect(res.title).toMatchObject({ kind: 'book', bookUrl: 'https://openlibrary.org/works/OL9990002W', genres: [{ key: 'drama', label: 'Drama' }] });

    // sem autor no cadastro: ganha o da Open Library; obra traduzida fica com o título PT-BR
    const semAutor = (await post(user, '/library', { title: 'O Relógio de Areia', kind: 'book' }).expect(201)).body;
    const r2 = (await post(user, `/library/${semAutor.id}/enrich`).expect(200)).body;
    expect(r2.title).toMatchObject({ creator: 'Ana Fictícia', pages: 212, bookUrl: 'https://openlibrary.org/works/OL9990001W' });
    expect(r2.title.genres.map((g: { key: string }) => g.key)).toEqual(['scifi']);
  });
});

describe('RF-43/RF-48: favorito de livro pela obra da Open Library', () => {
  it('aceita olWorkId, guarda capa/gêneros e não duplica a mesma obra', async () => {
    const user = await newUser();
    const fav = (await post(user, '/profile/favorites', { title: 'Vento Sul', kind: 'book', olWorkId: 'OL9990002W', rating: 4 }).expect(201)).body;
    expect(fav).toMatchObject({
      kind: 'book',
      title: 'Vento Sul',
      olWorkId: 'OL9990002W',
      posterUrl: 'https://covers.openlibrary.org/b/id/9990002-M.jpg',
      genres: [{ key: 'drama', label: 'Drama' }],
    });
    expect(fav.tmdbId).toBeUndefined();
    const again = (await post(user, '/profile/favorites', { title: 'Vento Sul', kind: 'book', olWorkId: 'OL9990002W', rating: 5 }).expect(201)).body;
    expect(again.id).toBe(fav.id);
    const declared = (await get(user, '/profile/declared').expect(200)).body;
    expect(declared.favorites).toHaveLength(1);
    expect(declared.favorites[0]).toMatchObject({ rating: 5, olWorkId: 'OL9990002W' });
    await post(user, '/profile/favorites', { title: 'X', kind: 'book', olWorkId: 'nada' }).expect(400);

    // cache de 30 dias da Open Library (TOS-REQ-62): a capa sai, os gêneros (CC0) ficam
    await withUser(db, user.userId, async (tx) => {
      await tx.execute(sql`update taste_favorites set resolved_at = now() - interval '31 days'`);
      await tx.execute(sql`select purge_expired_openlibrary_data()`);
    });
    const purged = (await get(user, '/profile/declared').expect(200)).body.favorites[0];
    expect(purged.posterUrl).toBeUndefined();
    expect(purged).toMatchObject({ olWorkId: 'OL9990002W', genres: [{ key: 'drama', label: 'Drama' }] });
  });
});
