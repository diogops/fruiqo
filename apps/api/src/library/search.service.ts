import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import type {
  BookSearchResult,
  ImportTitlesRequest,
  ImportTitlesResponse,
  Resolution,
  Title,
  TitleSearchResponse,
  TitleSearchResult,
} from '@fruiqo/contracts';
import { GENRES, genreTermsIn } from '@fruiqo/taxonomy';
import { DB, type Db, withUser } from '../db/client.js';
import { recommendations } from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';
import { matchScore, similarity } from '../pipeline/resolvers/match.js';
import { type BookHit, displayTitle, type OpenLibraryResolver } from '../pipeline/resolvers/openlibrary.js';
import type { TmdbHit, TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { llmSafeInput } from './mood-interpreter.js';
import { LibraryService } from './library.service.js';
import { ReviewService } from './review.service.js';
import { interpretSearchQuery, type SearchInterpretation, tmdbGenreIds } from './search-query.js';
import { OPENLIBRARY_CATALOG } from './openlibrary-catalog.js';
import { TITLE_GUESSER, type TitleGuess, type TitleGuesser } from './title-guesser.js';
import { TMDB_CATALOG } from './tmdb-catalog.js';
import { columnsFromResolution } from './tmdb-enrichment.js';
import { userAllowsAi } from './user-settings.js';

const MAX_RESULTS = 12;
const CAST_FOR = 8;
const MIN_TITLE_SCORE = 0.35;
/** nome de pessoa reconhecido pelo TMDB com esta similaridade ao texto = busca por pessoa */
const PERSON_MATCH = 0.85;
const BOOKS_IN_MIXED_SEARCH_MS = 6_000;
const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));

/** Limite por usuário em memória (1 instância em SC-PERSONAL; o ThrottlerGuard global é por IP). */
export class PerUserRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(userId: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(userId) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(userId, recent);
    return true;
  }
}

const tooMany = () => new HttpException('Muitas buscas em pouco tempo; espere um pouco', HttpStatus.TOO_MANY_REQUESTS);

/**
 * RF-46: incluir título por busca inteligente. Título (com erro de digitação/parcial), título + ano,
 * pessoa (elenco/direção), gênero/tema/década e descrição livre. O TMDB é consultado pela API; o
 * LLM só vê o texto digitado, só com a IA liberada (D-07/D-17) e com consentimento (SEC-CTRL-51).
 */
@Injectable()
export class SearchService {
  private readonly searchLimiter = new PerUserRateLimiter(Number(process.env.SEARCH_RATE_LIMIT_PER_MIN ?? 30), 60_000);
  private readonly importLimiter = new PerUserRateLimiter(Number(process.env.IMPORT_RATE_LIMIT_PER_MIN ?? 20), 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly review: ReviewService,
    private readonly library: LibraryService,
    @Optional() @Inject(TMDB_CATALOG) private readonly tmdb: TmdbResolver | null,
    @Optional() @Inject(TITLE_GUESSER) private readonly guesser: TitleGuesser | null,
    @Optional() @Inject(OPENLIBRARY_CATALOG) private readonly books: OpenLibraryResolver | null = null,
  ) {}

  async search(userId: string, q: string, kind?: 'movie' | 'series' | 'book', forceAi = false): Promise<TitleSearchResponse> {
    if (!this.searchLimiter.take(userId)) throw tooMany();
    // RF-48: livros só pela Open Library (sem TMDB, sem LLM)
    if (kind === 'book' || (!kind && !this.tmdb && this.books)) return this.searchBooksOnly(userId, q);
    const tmdb = this.requireTmdb();
    const interp = interpretSearchQuery(q, kind);
    // sem tipo: livros em paralelo (título/autor; gênero e descrição ficam no TMDB); a Open Library
    // lenta não segura a busca de filmes/séries: depois de BOOKS_IN_MIXED_SEARCH_MS, segue sem livros
    const booksPromise: Promise<BookHit[] | null> =
      !kind && this.books && interp.type !== 'genre' && !forceAi
        ? Promise.race([
            this.books.searchBooks(interp.text, 6).catch(() => [] as BookHit[]),
            new Promise<BookHit[]>((r) => setTimeout(() => r([]), BOOKS_IN_MIXED_SEARCH_MS).unref()),
          ])
        : Promise.resolve(null);
    let type: TitleSearchResponse['interpreted']['type'] = interp.type;
    let person: string | undefined;
    let aiUsed = false;
    let aiBooks: BookHit[] = [];
    let hits: { hit: TmdbHit; matchedBy: TitleSearchResult['matchedBy'] }[] = [];

    try {
      if (forceAi) {
        // "Buscar com IA": o pedido inteiro vai para a IA (com consentimento); sem ela, cai nas palavras-chave
        type = 'description';
        const described = await this.byDescription(tmdb, userId, q, interp);
        aiUsed = described.aiUsed;
        aiBooks = described.books;
        hits = described.hits.map((hit) => ({ hit, matchedBy: 'description' as const }));
      } else if (interp.type === 'genre') {
        hits = (await this.byGenre(tmdb, interp)).map((hit) => ({ hit, matchedBy: 'genre' as const }));
      } else {
        const multi = await tmdb.searchMulti(interp.text);
        const mediaType = interp.kind === 'series' ? 'tv' : interp.kind === 'movie' ? 'movie' : undefined;
        const ranked = multi.titles
          .map((hit) => ({ hit, score: scoreHit(hit, interp, mediaType) }))
          .filter((r) => r.score >= MIN_TITLE_SCORE && (!mediaType || r.hit.mediaType === mediaType))
          .sort((a, b) => b.score - a.score || b.hit.popularity - a.hit.popularity);
        const bestSim = Math.max(0, ...multi.titles.map((h) => titleSimilarity(interp.text, h)));
        const topPerson = multi.people.find((p) => similarity(interp.text, p.name) >= PERSON_MATCH);

        if (topPerson && bestSim < 0.9 && !interp.year) {
          type = 'person';
          person = topPerson.name;
          const credits = (await tmdb.personCredits(topPerson.id)).filter((h) => !mediaType || h.mediaType === mediaType);
          hits = credits.map((hit) => ({ hit, matchedBy: 'person' as const }));
        } else if (interp.maybeDescription && bestSim < 0.6) {
          type = 'description';
          const described = await this.byDescription(tmdb, userId, q, interp);
          aiUsed = described.aiUsed;
          aiBooks = described.books;
          hits = described.hits.map((hit) => ({ hit, matchedBy: 'description' as const }));
        } else {
          hits = ranked.map((r) => ({ hit: r.hit, matchedBy: 'title' as const }));
        }
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException('Busca indisponível agora; tente de novo');
    }

    const unique = dedupeHits(hits).slice(0, MAX_RESULTS);
    const casts = await mapLimit(unique.slice(0, CAST_FOR), 4, (h) => tmdb.topCast(h.hit.mediaType, h.hit.tmdbId).catch(() => [] as string[]));
    const library = await this.libraryIndex(userId);
    // livros palpitados pela IA (já conferidos na busca de livros) vêm antes dos da busca por texto
    const searched = await booksPromise;
    const bookHits = searched || aiBooks.length > 0 ? dedupeBooks([...aiBooks, ...(searched ?? [])]) : null;
    return {
      query: q,
      ...(bookHits ? { books: bookResults(bookHits, interp.text, library) } : {}),
      interpreted: {
        type,
        ...(interp.year ? { year: interp.year } : {}),
        ...(person ? { person } : {}),
        genres: interp.genres.map((key) => ({ key, label: GENRE_LABEL.get(key) ?? key })),
        ...(interp.decade ? { decade: interp.decade } : {}),
        aiUsed,
      },
      items: unique.map(({ hit, matchedBy }, i) => {
        const kind = hit.mediaType === 'tv' ? ('series' as const) : ('movie' as const);
        const mine =
          library.byExternal.get(`${hit.mediaType}:${hit.tmdbId}`) ?? library.byKey.get(dedupKey({ kind, title: hit.title, creator: null }));
        return {
          tmdbId: hit.tmdbId,
          mediaType: hit.mediaType,
          kind,
          title: hit.title,
          ...(hit.originalTitle ? { originalTitle: hit.originalTitle } : {}),
          ...(hit.year ? { year: hit.year } : {}),
          ...(hit.posterUrl ? { posterUrl: hit.posterUrl } : {}),
          ...(hit.overview ? { overview: shorten(hit.overview, 400) } : {}),
          cast: casts[i] ?? [],
          inLibrary: mine ?? null,
          matchedBy,
        };
      }),
    };
  }

  /**
   * RF-46: inclui os títulos escolhidos na busca. Sem `approveNow`, entram na revisão (RF-42) com o
   * encaixe sugerido; com `approveNow`, já são aprovados no encaixe sugerido (e na lista `listId`).
   */
  async import(userId: string, req: ImportTitlesRequest): Promise<ImportTitlesResponse> {
    if (!this.importLimiter.take(userId)) throw tooMany();
    if (req.listId && !req.approveNow) throw new BadRequestException('Entrada inválida: listId só vale com approveNow');
    const unique = [...new Map(req.items.map((i) => [`${i.mediaType}:${i.tmdbId}`, i])).values()];
    const bookIds = [...new Set((req.books ?? []).map((b) => b.olWorkId))];
    const tmdb = unique.length > 0 ? this.requireTmdb() : null;
    const books = bookIds.length > 0 ? this.requireBooks() : null;
    // rede fora da transação
    const resolved = await mapLimit(unique, 4, async (item) => ({ item, res: await tmdb!.byId(item.mediaType, item.tmdbId).catch(() => null) }));
    const resolvedBooks = await mapLimit(bookIds, 2, async (olWorkId) => ({ olWorkId, res: await books!.byWorkId(olWorkId).catch(() => null) }));

    return withUser(this.db, userId, async (tx) => {
      const existing = await tx.select({ id: recommendations.id, key: recommendations.dedupKey, resolution: recommendations.resolution }).from(recommendations);
      const byExternal = new Map(existing.filter((e) => e.resolution?.externalId).map((e) => [e.resolution!.externalId, e.id]));
      const byKey = new Map(existing.map((e) => [e.key, e.id]));
      const created: Title[] = [];
      const skipped: ImportTitlesResponse['skipped'] = [];
      for (const { item, res } of resolved) {
        if (!res) {
          skipped.push({ ...item, reason: 'not_found' });
          continue;
        }
        const kind = item.mediaType === 'tv' ? ('series' as const) : ('movie' as const);
        const key = dedupKey({ kind, title: res.title, creator: null });
        const existingId = byExternal.get(res.externalId) ?? byKey.get(key);
        if (existingId) {
          skipped.push({ ...item, reason: 'already_in_list', existingId });
          continue;
        }
        const cols = columnsFromResolution(res);
        const [row] = await tx
          .insert(recommendations)
          .values({
            userId,
            shareId: null,
            kind,
            title: res.title,
            year: cols?.year ?? null,
            confidence: 1,
            extractor: 'heuristic',
            resolution: res,
            resolvedAt: new Date(),
            genres: cols?.genres ?? [],
            runtimeMin: cols?.runtimeMin ?? null,
            enrichment: 'tmdb',
            dedupKey: key,
            decision: 'review_queue',
            suggestedDecision: 'cataloged',
            decisionReason: 'search_import',
            matchScore: 1,
          })
          .returning();
        byKey.set(key, row!.id);
        byExternal.set(res.externalId, row!.id);
        if (req.approveNow) {
          created.push(await this.review.approveWithin(tx, userId, row!.id, req.listId ? { listIds: [req.listId] } : {}, null));
        } else {
          created.push(...(await this.library.withLists(tx, [row!])));
        }
      }
      // RF-48: livros escolhidos na busca (Open Library), mesmo fluxo de revisão
      const skippedBooks: NonNullable<ImportTitlesResponse['skippedBooks']> = [];
      for (const { olWorkId, res } of resolvedBooks) {
        if (!res) {
          skippedBooks.push({ olWorkId, reason: 'not_found' });
          continue;
        }
        const creator = res.authors?.[0] ?? null;
        const key = dedupKey({ kind: 'book', title: res.title, creator });
        const existingId = byExternal.get(res.externalId) ?? byKey.get(key);
        if (existingId) {
          skippedBooks.push({ olWorkId, reason: 'already_in_list', existingId });
          continue;
        }
        const cols = columnsFromResolution(res);
        const [row] = await tx
          .insert(recommendations)
          .values({
            userId,
            shareId: null,
            kind: 'book',
            title: res.title,
            creator,
            year: cols?.year ?? null,
            confidence: 1,
            extractor: 'heuristic',
            resolution: res,
            resolvedAt: new Date(),
            genres: cols?.genres ?? [],
            enrichment: 'openlibrary',
            dedupKey: key,
            decision: 'review_queue',
            suggestedDecision: 'cataloged',
            decisionReason: 'search_import',
            matchScore: 1,
          })
          .returning();
        byKey.set(key, row!.id);
        byExternal.set(res.externalId, row!.id);
        if (req.approveNow) {
          created.push(await this.review.approveWithin(tx, userId, row!.id, req.listId ? { listIds: [req.listId] } : {}, null));
        } else {
          created.push(...(await this.library.withLists(tx, [row!])));
        }
      }
      return { created, skipped, ...(bookIds.length > 0 ? { skippedBooks } : {}) };
    });
  }

  /** RF-48: busca só de livros (título ou autor, ex.: "Machado de Assis"). */
  private async searchBooksOnly(userId: string, q: string): Promise<TitleSearchResponse> {
    const books = this.requireBooks();
    const text = q.trim();
    let hits: BookHit[];
    try {
      hits = await books.searchBooks(text, MAX_RESULTS);
    } catch {
      throw new ServiceUnavailableException('Busca indisponível agora; tente de novo');
    }
    const library = await this.libraryIndex(userId);
    const author = authorIn(text, hits);
    return {
      query: q,
      interpreted: { type: author ? 'person' : 'title', ...(author ? { person: author } : {}), genres: [], aiUsed: false },
      items: [],
      books: bookResults(hits, text, library),
    };
  }

  private requireBooks(): OpenLibraryResolver {
    if (!this.books) throw new ServiceUnavailableException('Busca de livros indisponível');
    return this.books;
  }

  private requireTmdb(): TmdbResolver {
    if (!this.tmdb) throw new ServiceUnavailableException('Busca de filmes e séries indisponível (TMDB não configurado)');
    return this.tmdb;
  }

  /** Gênero/tema/década: /discover de filme e/ou série, mais populares primeiro. */
  private async byGenre(tmdb: TmdbResolver, interp: SearchInterpretation): Promise<TmdbHit[]> {
    const medias: ('movie' | 'tv')[] = interp.kind === 'series' ? ['tv'] : interp.kind === 'movie' ? ['movie'] : ['movie', 'tv'];
    // "recente/lançamento": últimos 3 anos; década explícita vence
    const recentFrom = interp.recent ? new Date().getFullYear() - 3 : undefined;
    const from = interp.decade ?? recentFrom;
    const to = interp.decade ? interp.decade + 9 : undefined;
    const lists = await Promise.all(
      medias.map((m) => {
        const ids = tmdbGenreIds(interp.genres, m);
        // gênero sem equivalente nesse tipo (ex.: reality em filme): pula
        if (interp.genres.length > 0 && ids.length === 0) return Promise.resolve([] as TmdbHit[]);
        return tmdb.discover(m, ids, from, to);
      }),
    );
    return interleave(lists);
  }

  /**
   * Descrição livre: com a IA liberada e consentida, o LLM sugere títulos (só com o texto digitado)
   * e cada palpite é conferido: filme/série no TMDB, livro na Open Library (RF-48). Palpite que não
   * se confirma é descartado. Sem IA: gêneros citados (discover) + palavras-chave.
   */
  private async byDescription(
    tmdb: TmdbResolver,
    userId: string,
    q: string,
    interp: SearchInterpretation,
  ): Promise<{ hits: TmdbHit[]; books: BookHit[]; aiUsed: boolean }> {
    if (this.guesser && (await userAllowsAi(this.db, userId))) {
      const all = await this.guesser.guess(llmSafeInput(q), userId);
      const bookGuesses = (all ?? []).filter((g) => g.kind === 'book' && interp.kind === undefined);
      const guesses = (all ?? []).filter((g) => g.kind !== 'book');
      if (all && all.length > 0) {
        const books = this.books ? await this.confirmBooks(this.books, bookGuesses) : [];
        const found = await mapLimit(guesses, 3, async (g) => {
          const multi = await tmdb.searchMulti(g.title).catch(() => null);
          const media = g.kind === 'series' ? 'tv' : 'movie';
          const best = multi?.titles
            .map((hit) => ({ hit, score: matchScore({ title: g.title, ...(g.year ? { year: g.year } : {}), mediaType: media }, hit) }))
            .sort((a, b) => b.score - a.score)[0];
          return best && best.score >= 0.6 ? best.hit : null;
        });
        return { hits: found.filter((h): h is TmdbHit => h !== null), books, aiUsed: true };
      }
    }
    const genres = genreTermsIn(q).genres;
    const lists: TmdbHit[][] = [];
    if (genres.length > 0) lists.push(await this.byGenre(tmdb, { ...interp, genres }));
    for (const k of interp.keywords.slice(0, 2)) lists.push((await tmdb.searchMulti(k)).titles);
    return { hits: interleave(lists), books: [], aiUsed: false };
  }

  /** Palpite de livro da IA → obra da Open Library com título parecido (e autor, quando veio). */
  private async confirmBooks(books: OpenLibraryResolver, guesses: TitleGuess[]): Promise<BookHit[]> {
    const found = await mapLimit(guesses, 2, async (g) => {
      const hits = await books.searchBooks(g.author ? `${g.title} ${g.author}` : g.title, 3).catch(() => [] as BookHit[]);
      return (
        hits.find(
          (h) =>
            Math.max(similarity(g.title, h.title), h.ptTitle ? similarity(g.title, h.ptTitle) : 0) >= 0.6 &&
            (!g.author || h.authors.some((a) => similarity(g.author!, a) >= PERSON_MATCH)),
        ) ?? null
      );
    });
    return found.filter((h): h is BookHit => h !== null);
  }

  private async libraryIndex(userId: string) {
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select({ id: recommendations.id, rank: recommendations.rank, decision: recommendations.decision, key: recommendations.dedupKey, resolution: recommendations.resolution })
        .from(recommendations),
    );
    type Ref = NonNullable<TitleSearchResult['inLibrary']>;
    const ref = (r: (typeof rows)[number]): Ref => ({ id: r.id, rank: r.rank, decision: r.decision });
    return {
      byExternal: new Map<string, Ref>(rows.filter((r) => r.resolution?.externalId).map((r) => [(r.resolution as Resolution).externalId, ref(r)])),
      byKey: new Map<string, Ref>(rows.map((r) => [r.key, ref(r)])),
    };
  }
}

type LibraryIndex = Awaited<ReturnType<SearchService['libraryIndex']>>;

function dedupeBooks(hits: BookHit[]): BookHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.olWorkId) && seen.add(h.olWorkId));
}

/** Nome de autor dos resultados que corresponde ao texto digitado (busca por autor). */
function authorIn(text: string, hits: BookHit[]): string | null {
  for (const h of hits) for (const a of h.authors) if (similarity(text, a) >= PERSON_MATCH) return a;
  return null;
}

function bookResults(hits: BookHit[], text: string, library: LibraryIndex): BookSearchResult[] {
  const author = authorIn(text, hits);
  return hits.map((h) => {
    const mine =
      library.byExternal.get(`ol:${h.olWorkId}`) ??
      library.byKey.get(dedupKey({ kind: 'book', title: displayTitle(h), creator: null })) ??
      library.byKey.get(dedupKey({ kind: 'book', title: h.title, creator: null }));
    return {
      olWorkId: h.olWorkId,
      title: displayTitle(h),
      authors: h.authors.slice(0, 5),
      ...(h.year ? { year: h.year } : {}),
      ...(h.coverUrl ? { coverUrl: h.coverUrl } : {}),
      ...(h.pages ? { pages: h.pages } : {}),
      url: `https://openlibrary.org/works/${h.olWorkId}`,
      inLibrary: mine ?? null,
      matchedBy: author && h.authors.some((a) => similarity(a, author) >= PERSON_MATCH) ? ('author' as const) : ('title' as const),
    };
  });
}

function titleSimilarity(text: string, h: TmdbHit): number {
  return Math.max(similarity(text, h.title), h.originalTitle ? similarity(text, h.originalTitle) : 0);
}

function scoreHit(hit: TmdbHit, interp: SearchInterpretation, mediaType: 'movie' | 'tv' | undefined): number {
  return matchScore(
    { title: interp.text, ...(interp.year ? { year: interp.year } : {}), ...(mediaType ? { mediaType } : {}) },
    { title: hit.title, ...(hit.originalTitle ? { originalTitle: hit.originalTitle } : {}), ...(hit.year ? { year: hit.year } : {}), mediaType: hit.mediaType, popularity: hit.popularity },
  );
}

function dedupeHits<T extends { hit: TmdbHit }>(hits: T[]): T[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.hit.mediaType}:${h.hit.tmdbId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Junta listas alternando (filme, série, filme…) para nenhuma dominar o topo. */
function interleave(lists: TmdbHit[][]): TmdbHit[] {
  const out: TmdbHit[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
