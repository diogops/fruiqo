import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import type {
  AiFindTitlesRequest,
  AiFindTitlesResponse,
  BookSearchResult,
  ImportTitlesRequest,
  ImportTitlesResponse,
  Resolution,
  Title,
  ClassifyTitlesResponse,
  TitleSearchQuery,
  TitleSearchResponse,
  TitleSearchResult,
} from '@fruiqo/contracts';
import { GENRES, genresFromTmdb, genreTermsIn } from '@fruiqo/taxonomy';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { recommendations, tasteSignals } from '../db/schema.js';
import { autoRating, recomputeAutoRatings, trustedGeneral } from './auto-rating.js';
import { loadFitContext } from './fit-context.js';
import { dedupKey } from '../pipeline/dedup.js';
import { matchScore, similarity } from '../pipeline/resolvers/match.js';
import { type BookHit, displayTitle, type OpenLibraryResolver } from '../pipeline/resolvers/openlibrary.js';
import { isAnime, type TmdbHit, type TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { llmSafeInput } from './mood-interpreter.js';
import { LibraryService } from './library.service.js';
import { ReviewService } from './review.service.js';
import { type BrowseInterpretation, interpretBrowseQuery, SERVICES } from './browse-query.js';
import { interpretSearchQuery, type SearchInterpretation, tmdbGenreIds } from './search-query.js';
import { OPENLIBRARY_CATALOG } from './openlibrary-catalog.js';
import { AI_TITLE_FINDER, type AiTitleFinder } from './ai-title-finder.js';
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
/** D-23: exploração */
const PERSON_IN_BROWSE = 0.6;
const RECENT_DAYS = 120;
const UPCOMING_DAYS = 180;
const SHORT_MAX_MIN = 40;
/** D-23: semelhança mínima de título para sugerir a categoria no import */
const CLASSIFY_MIN_SIMILARITY = 0.75;
/** link de uma obra no site do TMDB (filme ou série), com ou sem o nome depois do ID */
const TMDB_LINK = /^(?:https?:\/\/)?(?:www\.)?themoviedb\.org\/(movie|tv)\/(\d{1,9})(?:-[^/?#]*)?(?:[/?#].*)?$/i;
/** D-24: semelhança mínima entre o palpite da IA e o TMDB para confirmar a obra */
const AI_MATCH_MIN = 0.6;
/** dois resultados com pontuação a menos disto, sem ano no palpite: ambíguo */
const AI_MATCH_MARGIN = 0.05;
const AI_MAX_RESULTS = 30;
/** gêneros sem equivalente em séries no TMDB: Mistério (9648), Crime (80), Sci-Fi & Fantasy (10765) */
const TV_GENRE_PROXY: Partial<Record<string, number[]>> = { thriller: [9648, 80], horror: [9648, 10765] };
const BROWSE_EXCLUDE_TV: { genre: string; ids: number[] }[] = [
  { genre: 'family', ids: [10762] },
  { genre: 'news', ids: [10763] },
  { genre: 'talk', ids: [10767] },
  { genre: 'reality', ids: [10764] },
  { genre: 'animation', ids: [16] },
];
const BROWSE_EXCLUDE_MOVIE: { genre: string; ids: number[] }[] = [
  { genre: 'documentary', ids: [99] },
  { genre: 'tv_movie', ids: [10770] },
];
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
    @Optional() @Inject(AI_TITLE_FINDER) private readonly finder: AiTitleFinder | null = null,
  ) {}

  async search(
    userId: string,
    q: string,
    kind?: 'movie' | 'series' | 'book',
    forceAi = false,
    sortParam?: SearchSort,
  ): Promise<TitleSearchResponse> {
    if (!this.searchLimiter.take(userId)) throw tooMany();
    // "Buscar com IA" sem IA disponível (desligada ou sem consentimento): busca normal, não palavras soltas
    let aiUnavailable = false;
    if (forceAi && !(this.guesser && (await userAllowsAi(this.db, userId)))) {
      forceAi = false;
      aiUnavailable = true;
    }
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
    // link do TMDB colado ("https://www.themoviedb.org/tv/276161-nome"): o título exato, pelo ID
    const link = TMDB_LINK.exec(q.trim());
    if (link) {
      const mediaType = link[1] as 'movie' | 'tv';
      const res = await tmdb.byId(mediaType, Number(link[2]), undefined, { titleLinks: false }).catch(() => null);
      const hit: TmdbHit | null = res?.tmdbId
        ? {
            tmdbId: res.tmdbId,
            mediaType,
            title: res.title,
            ...(res.year ? { year: res.year } : {}),
            ...(res.imageUrl ? { posterUrl: res.imageUrl } : {}),
            ...(res.overview ? { overview: res.overview } : {}),
            popularity: 0,
            genreIds: res.genreIds ?? [],
            ...(res.voteAverage != null ? { voteAverage: res.voteAverage } : {}),
            ...(res.voteCount != null ? { voteCount: res.voteCount } : {}),
          }
        : null;
      const library = await this.libraryIndex(userId);
      return {
        query: q,
        interpreted: { type: 'title', genres: [], aiUsed: false, sort: 'relevance' },
        items: hit ? await this.mediaResults(tmdb, userId, [{ hit, matchedBy: 'title' }], 'relevance', library, 1) : [],
      };
    }
    let type: TitleSearchResponse['interpreted']['type'] = interp.type;
    let person: string | undefined;
    let aiUsed = false;
    let aiBooks: BookHit[] = [];
    let hits: { hit: TmdbHit; matchedBy: TitleSearchResult['matchedBy'] }[] = [];
    let labels: string[] | undefined;

    try {
      // D-23: "melhor série da Netflix", "lançamentos de terror", "filmes em breve"...
      const browse = !forceAi ? interpretBrowseQuery(q, kind) : null;
      const browsed = browse ? await this.byBrowse(tmdb, browse) : null;
      if (browse && browsed) {
        type = 'browse';
        labels = browse.labels;
        person = browsed.person;
        hits = browsed.hits.map((hit) => ({ hit, matchedBy: 'browse' as const }));
      } else if (forceAi) {
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

    // D-23: sua ordem (manual → estrelas → automática → geral); busca por nome ou pessoa fica por
    // relevância (a filmografia na ordem de popularidade do TMDB)
    const sort: SearchSort = sortParam ?? (type === 'title' || type === 'person' ? 'relevance' : 'score');
    const library = await this.libraryIndex(userId);
    const items = await this.mediaResults(tmdb, userId, hits, sort, library);
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
        ...(labels ? { labels } : {}),
        ...(aiUnavailable ? { aiUnavailable } : {}),
        sort,
        aiUsed,
      },
      items,
    };
  }

  /** Títulos do TMDB → resultados de busca (o que já é seu, nota automática, elenco), na ordem dada. */
  async toResults(userId: string, hits: TmdbHit[], matchedBy: TitleSearchResult['matchedBy'], limit = MAX_RESULTS): Promise<TitleSearchResult[]> {
    const tmdb = this.requireTmdb();
    return this.mediaResults(tmdb, userId, hits.map((hit) => ({ hit, matchedBy })), 'relevance', await this.libraryIndex(userId), limit);
  }

  /** Filmes/séries para a resposta: o que já é seu, nota automática pelo seu gosto e elenco principal. */
  private async mediaResults(
    tmdb: TmdbResolver,
    userId: string,
    hits: { hit: TmdbHit; matchedBy: TitleSearchResult['matchedBy'] }[],
    sort: SearchSort,
    library: Awaited<ReturnType<SearchService['libraryIndex']>>,
    limit = MAX_RESULTS,
  ): Promise<TitleSearchResult[]> {
    const fitCtx = await withUser(this.db, userId, (tx) => loadFitContext(tx));
    const scored = dedupeHits(hits).map((h) => {
      const mine = library.byExternal.get(`${h.hit.mediaType}:${h.hit.tmdbId}`) ?? null;
      return { ...h, mine, auto: autoRating(fitTitleOfHit(h.hit), fitCtx) };
    });
    const unique = orderSearchHits(scored, sort).slice(0, limit);
    const autoOf = new Map(unique.map((u) => [`${u.hit.mediaType}:${u.hit.tmdbId}`, u.auto]));
    const casts = await mapLimit(unique.slice(0, CAST_FOR), 4, (h) => tmdb.topCast(h.hit.mediaType, h.hit.tmdbId).catch(() => [] as string[]));
    return unique.map(({ hit, matchedBy }, i) => {
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
        ...(hit.voteAverage != null && hit.voteCount ? { generalRating: hit.voteAverage, generalVotes: hit.voteCount } : {}),
        ...(autoOf.get(`${hit.mediaType}:${hit.tmdbId}`) != null ? { autoRating: autoOf.get(`${hit.mediaType}:${hit.tmdbId}`)! } : {}),
        ...(isAnime(hit) ? { anime: true } : {}),
        ...(hit.genreIds.length ? { genres: Object.keys(genresFromTmdb(hit.genreIds, hit.mediaType)) } : {}),
      };
    });
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
          // D-23: já estava no catálogo → vai para a Minha Área; já na Minha Área → nada a fazer
          const moved = await this.toMyArea(tx, userId, existingId, req.listId);
          if (moved) created.push(moved);
          else skipped.push({ ...item, reason: 'already_in_list', existingId });
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
            // D-23: sem revisão; escolhido na busca = Quero assistir (fim da fila)
            decision: 'cataloged',
            status: 'to_watch',
            suggestedDecision: 'cataloged',
            decisionReason: 'search_import',
            matchScore: 1,
          })
          .returning();
        byKey.set(key, row!.id);
        byExternal.set(res.externalId, row!.id);
        created.push(await this.addedToMyArea(tx, userId, row!.id, req.listId));
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
          const moved = await this.toMyArea(tx, userId, existingId, req.listId);
          if (moved) created.push(moved);
          else skippedBooks.push({ olWorkId, reason: 'already_in_list', existingId });
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
            // D-23: sem revisão; escolhido na busca = Quero assistir (fim da fila)
            decision: 'cataloged',
            status: 'to_watch',
            suggestedDecision: 'cataloged',
            decisionReason: 'search_import',
            matchScore: 1,
          })
          .returning();
        byKey.set(key, row!.id);
        byExternal.set(res.externalId, row!.id);
        created.push(await this.addedToMyArea(tx, userId, row!.id, req.listId));
      }
      // escolher é sinal de gosto: as notas automáticas acompanham
      if (created.length > 0) await recomputeAutoRatings(tx);
      const fresh = created.length > 0 ? await this.library.withLists(tx, await tx.select().from(recommendations).where(inArray(recommendations.id, created.map((c) => c.id)))) : [];
      const byId = new Map(fresh.map((t) => [t.id, t]));
      return { created: created.map((c) => byId.get(c.id) ?? c), skipped, ...(bookIds.length > 0 ? { skippedBooks } : {}) };
    });
  }

  /** Título novo na Minha Área: sinal de gosto, lista opcional. */
  private async addedToMyArea(tx: Tx, userId: string, id: string, listId?: string): Promise<Title> {
    await tx.insert(tasteSignals).values({ userId, recommendationId: id, signal: 'added_to_list' });
    if (listId) await this.review.appendToList(tx, userId, listId, [id]);
    const [row] = await tx.select().from(recommendations).where(eq(recommendations.id, id));
    return (await this.library.withLists(tx, [row!]))[0]!;
  }

  /** Título que já existe: sai do catálogo para "Quero assistir"; null se já estava na Minha Área. */
  private async toMyArea(tx: Tx, userId: string, id: string, listId?: string): Promise<Title | null> {
    const [row] = await tx.select({ status: recommendations.status }).from(recommendations).where(eq(recommendations.id, id));
    if (!row || (row.status !== 'catalog' && row.status !== 'dropped')) return null;
    await tx.update(recommendations).set({ status: 'to_watch', updatedAt: new Date() }).where(eq(recommendations.id, id));
    return this.addedToMyArea(tx, userId, id, listId);
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
  /**
   * D-23: exploração ao vivo no TMDB (/discover). "Melhor" ordena pela nota geral com mínimo de
   * votos; lançamentos = últimos 120 dias; "em breve" = próximos 180. O que sobrou do texto precisa
   * ser uma pessoa conhecida no TMDB; se não for, devolve null e segue a busca normal (por título).
   */
  /**
   * D-23: categoria de cada título lido num import (print/texto), pelo resultado mais parecido do
   * TMDB. Só filmes/séries; livro ou grafia muito diferente fica sem sugestão (null).
   */
  async classify(userId: string, titles: string[]): Promise<ClassifyTitlesResponse> {
    if (!this.searchLimiter.take(userId)) throw tooMany();
    const tmdb = this.requireTmdb();
    const items = await mapLimit(titles, 4, async (raw) => {
      const interp = interpretSearchQuery(raw);
      try {
        const { titles: hits } = await tmdb.searchMulti(interp.text);
        const best = hits
          .map((hit) => ({ hit, sim: titleSimilarity(interp.text, hit), yearOk: !interp.year || hit.year === interp.year }))
          .filter((r) => r.sim >= CLASSIFY_MIN_SIMILARITY)
          .sort((a, b) => Number(b.yearOk) - Number(a.yearOk) || b.sim - a.sim || b.hit.popularity - a.hit.popularity)[0];
        if (!best) return { title: raw, kind: null };
        return {
          title: raw,
          kind: best.hit.mediaType === 'tv' ? ('series' as const) : ('movie' as const),
          tmdbTitle: best.hit.title,
          ...(best.hit.year ? { year: best.hit.year } : {}),
        };
      } catch {
        return { title: raw, kind: null };
      }
    });
    return { items };
  }

  /**
   * D-24: títulos achados pela IA numa descrição digitada (`describe`) ou no texto lido de um print
   * (`ocr`). Cada palpite de filme/série é conferido no TMDB; o que não se confirma (livro, grafia
   * diferente) volta em `notFound` para o usuário decidir. Sem IA (desligada, sem consentimento, print
   * não liberado), `aiUsed: false` com o motivo, e quem chama segue sem IA.
   */
  async aiFind(userId: string, req: AiFindTitlesRequest): Promise<AiFindTitlesResponse> {
    const none = (unavailable: NonNullable<AiFindTitlesResponse['unavailable']>): AiFindTitlesResponse => ({ aiUsed: false, unavailable, items: [], notFound: [] });
    if (!this.finder) return none('disabled');
    if (req.mode === 'ocr' && !this.finder.ocrAllowed) return none('ocr_not_allowed');
    if (!this.searchLimiter.take(userId)) throw tooMany();
    if (!(await userAllowsAi(this.db, userId))) return none('consent');
    // sem TMDB não há como conferir: falha antes de gastar a IA
    this.requireTmdb();
    const res = await this.finder.find(req.mode, llmSafeInput(req.text), userId, req.kind);
    if (!res.ok) return none(res.reason);

    const found = await this.confirmGuesses(userId, res.titles, {
      matchedBy: req.mode === 'describe' ? 'description' : 'title',
      ...(req.kind ? { kind: req.kind } : {}),
    });
    return { aiUsed: true, items: found.items, notFound: found.notFound };
  }

  /**
   * Palpites da IA (título/tipo/ano) → obras confirmadas no TMDB, na ordem dos palpites, com o que
   * já é seu e o motivo da IA. Livro e palpite sem obra parecida voltam em `notFound`.
   */
  async confirmGuesses(
    userId: string,
    guesses: { title: string; kind: 'movie' | 'series' | 'book'; year?: number; reason?: string }[],
    opts: { matchedBy: TitleSearchResult['matchedBy']; kind?: 'movie' | 'series'; limit?: number },
  ): Promise<{ items: (TitleSearchResult & { aiReason?: string })[]; notFound: AiFindTitlesResponse['notFound'] }> {
    const tmdb = this.requireTmdb();
    const checked = await mapLimit(guesses, 4, async (g) => {
      if (g.kind === 'book') return { g, hit: null };
      const mediaType = g.kind === 'series' ? ('tv' as const) : ('movie' as const);
      const multi = await tmdb.searchMulti(g.title).catch(() => null);
      const ranked = (multi?.titles ?? [])
        .filter((hit) => !opts.kind || hit.mediaType === (opts.kind === 'series' ? 'tv' : 'movie'))
        .map((hit) => ({ hit, score: matchScore({ title: g.title, ...(g.year ? { year: g.year } : {}), mediaType }, hit) }))
        .sort((a, b) => b.score - a.score || b.hit.popularity - a.hit.popularity);
      const [best, second] = ranked;
      if (!best || best.score < AI_MATCH_MIN) return { g, hit: null };
      // ano informado tem de bater (±1: estreia em festival × lançamento)
      if (g.year && best.hit.year && Math.abs(best.hit.year - g.year) > 1) return { g, hit: null };
      // remake/homônimo quase empatado e sem ano para desempatar: ambíguo, descarta
      if (!g.year && second && second.score >= best.score - AI_MATCH_MARGIN) return { g, hit: null };
      return { g, hit: best.hit };
    });
    const reasonOf = new Map<string, string>();
    for (const { g, hit } of checked) if (hit && g.reason && !reasonOf.has(`${hit.mediaType}:${hit.tmdbId}`)) reasonOf.set(`${hit.mediaType}:${hit.tmdbId}`, g.reason);
    const hits = checked.flatMap(({ hit }) => (hit ? [{ hit, matchedBy: opts.matchedBy }] : []));
    let items: TitleSearchResult[] = [];
    try {
      // na ordem da IA (mais provável primeiro / ordem em que aparecem no print)
      items = await this.mediaResults(tmdb, userId, hits, 'relevance', await this.libraryIndex(userId), opts.limit ?? AI_MAX_RESULTS);
    } catch {
      throw new ServiceUnavailableException('Busca indisponível agora; tente de novo');
    }
    return {
      items: items.map((it) => {
        const aiReason = reasonOf.get(`${it.mediaType}:${it.tmdbId}`);
        return aiReason ? { ...it, aiReason } : it;
      }),
      notFound: checked.flatMap(({ g, hit }) => (hit ? [] : [{ title: g.title, kind: g.kind, ...(g.year ? { year: g.year } : {}) }])),
    };
  }

  private async byBrowse(tmdb: TmdbResolver, b: BrowseInterpretation): Promise<{ hits: TmdbHit[]; person?: string } | null> {
    let personId: number | undefined;
    let personName: string | undefined;
    if (b.person) {
      const p = await tmdb.searchPerson(b.person);
      if (!p || similarity(b.person, p.name) < PERSON_IN_BROWSE) return null;
      personId = p.id;
      personName = p.name;
    }
    const medias: ('movie' | 'tv')[] = b.short || b.kind === 'movie' ? ['movie'] : b.miniseries || b.kind === 'series' ? ['tv'] : ['movie', 'tv'];
    const providerIds = b.services.flatMap((k) => SERVICES.find((s) => s.key === k)?.tmdbIds ?? []);
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const dates =
      b.releases === 'recent'
        ? { fromDate: day(-RECENT_DAYS), toDate: day(0) }
        : b.releases === 'upcoming'
          ? { fromDate: day(1), toDate: day(UPCOMING_DAYS) }
          : b.decade
            ? { fromDate: `${b.decade}-01-01`, toDate: `${b.decade + 9}-12-31` }
            : {};
    const best = b.best && b.releases !== 'upcoming';
    const narrow = providerIds.length > 0 || b.genres.length > 0 || b.keywordIds.length > 0 || b.miniseries;
    // mínimo de votos para "melhor": sem ele, nota alta de poucos votos (vídeos, compilações) domina o topo
    const minVotes = (m: 'movie' | 'tv') =>
      !best
        ? undefined
        : b.releases
          ? 20
          : b.short
            ? 50
            : personId
              ? 200
              : b.miniseries
                ? 150
                : m === 'movie'
                  ? narrow ? 1000 : 3000
                  : narrow ? 500 : 1500;
    // fora do que não foi pedido: infantil, notícia, talk show, reality e animação (séries);
    // documentário e filme para TV (filmes)
    const exclude = (m: 'movie' | 'tv') =>
      (m === 'tv' ? BROWSE_EXCLUDE_TV : BROWSE_EXCLUDE_MOVIE).filter((x) => !(b.genres as string[]).includes(x.genre)).flatMap((x) => x.ids);

    const lists = await Promise.all(
      medias.map(async (m) => {
        // séries no TMDB não têm Suspense nem Terror: usa o mais próximo (qualquer um deles)
        const proxied = m === 'tv' && b.genres.some((g) => TV_GENRE_PROXY[g] && tmdbGenreIds([g], 'tv').length === 0);
        const genreIds = [...new Set([...tmdbGenreIds(b.genres, m), ...(m === 'tv' ? b.genres.flatMap((g) => (tmdbGenreIds([g], 'tv').length ? [] : (TV_GENRE_PROXY[g] ?? []))) : [])])];
        if (b.genres.length > 0 && genreIds.length === 0) return [] as TmdbHit[];
        // o /discover/tv não filtra por pessoa: séries da pessoa vêm da filmografia
        if (m === 'tv' && personId) {
          const credits = (await tmdb.personCredits(personId)).filter(
            (h) => h.mediaType === 'tv' && (!genreIds.length || genreIds.some((g) => h.genreIds.includes(g))),
          );
          return best ? credits.filter((h) => (h.voteCount ?? 0) >= 50).sort((x, y) => (y.voteAverage ?? 0) - (x.voteAverage ?? 0)) : credits;
        }
        const mv = minVotes(m);
        return tmdb.discoverBrowse(m, {
          sort: best ? 'best' : 'popular',
          ...(genreIds.length ? { genreIds, ...(proxied ? { anyGenre: true } : {}) } : {}),
          ...(b.keywordIds.length ? { keywordIds: b.keywordIds } : {}),
          ...(exclude(m).length ? { withoutGenreIds: exclude(m) } : {}),
          ...(providerIds.length ? { providerIds } : {}),
          ...(personId ? { personId } : {}),
          ...(b.miniseries ? { miniseries: true } : {}),
          ...(b.short ? { maxRuntime: SHORT_MAX_MIN } : {}),
          ...dates,
          ...(mv ? { minVotes: mv } : {}),
        });
      }),
    );
    // "melhor": nota geral decide entre filmes e séries; senão, alterna para nenhum dominar o topo
    const hits = best ? lists.flat().sort((x, y) => (y.voteAverage ?? 0) - (x.voteAverage ?? 0)) : interleave(lists);
    return { hits, ...(personName ? { person: personName } : {}) };
  }

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

  /** D-25: palpites de livro da IA → obras da Open Library, com o que já é seu e o motivo da IA. */
  async confirmBookGuesses(
    userId: string,
    guesses: { title: string; creator?: string; reason?: string }[],
  ): Promise<(BookSearchResult & { aiReason?: string })[]> {
    const books = this.requireBooks();
    const found = await this.confirmBooks(
      books,
      guesses.map((g) => ({ title: g.title, kind: 'book' as const, ...(g.creator ? { author: g.creator } : {}) })),
    );
    const library = await this.libraryIndex(userId);
    const results = bookResults(found, '', library);
    // o motivo segue o palpite que achou a obra (mesma ordem)
    return results.map((r, i) => {
      const g = guesses.find((x) => similarity(x.title, found[i]!.title) >= 0.6 || (found[i]!.ptTitle ? similarity(x.title, found[i]!.ptTitle!) >= 0.6 : false));
      return g?.reason ? { ...r, aiReason: g.reason } : r;
    });
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
        .select({
          id: recommendations.id,
          rank: recommendations.rank,
          decision: recommendations.decision,
          status: recommendations.status,
          rating: recommendations.rating,
          key: recommendations.dedupKey,
          resolution: recommendations.resolution,
        })
        .from(recommendations),
    );
    type Ref = NonNullable<TitleSearchResult['inLibrary']>;
    const ref = (r: (typeof rows)[number]): Ref => ({ id: r.id, rank: r.rank, decision: r.decision, status: r.status, rating: r.rating });
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

type SearchSort = NonNullable<TitleSearchQuery['sort']>;
type InLibrary = NonNullable<TitleSearchResult['inLibrary']>;

/** Gêneros da taxonomia a partir dos IDs do TMDB, para a nota automática de um resultado. */
function fitTitleOfHit(hit: TmdbHit) {
  const weights = genresFromTmdb(hit.genreIds, hit.mediaType);
  return {
    title: hit.title,
    genres: Object.keys(weights).filter((g) => (weights[g as keyof typeof weights] ?? 0) > 0),
    tmdbId: hit.tmdbId,
    mediaType: hit.mediaType,
    generalRating: trustedGeneral(hit.voteAverage, hit.voteCount),
  };
}

/**
 * D-23: `score` = ordem manual (posição na Minha Área) → suas estrelas → nota automática → geral;
 * `auto`/`general` pela nota escolhida; `relevance` mantém a ordem da busca. Estável.
 */
export function orderSearchHits<T extends { hit: TmdbHit; mine: InLibrary | null; auto: number | null }>(items: T[], sort: SearchSort): T[] {
  if (sort === 'relevance') return items;
  const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : dir * (a - b);
  const general = (x: T) => trustedGeneral(x.hit.voteAverage, x.hit.voteCount);
  return items
    .map((x, i) => ({ x, i }))
    .sort((p, q) => {
      const a = p.x;
      const b = q.x;
      const steps =
        sort === 'auto'
          ? [nullsLast(a.auto, b.auto, -1), nullsLast(general(a), general(b), -1)]
          : sort === 'general'
            ? [nullsLast(general(a), general(b), -1), nullsLast(a.auto, b.auto, -1)]
            : [
                nullsLast(a.mine?.rank, b.mine?.rank, 1),
                nullsLast(a.mine?.rating, b.mine?.rating, -1),
                nullsLast(a.auto, b.auto, -1),
                nullsLast(general(a), general(b), -1),
              ];
      return steps.find((d) => d !== 0) ?? p.i - q.i;
    })
    .map(({ x }) => x);
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
