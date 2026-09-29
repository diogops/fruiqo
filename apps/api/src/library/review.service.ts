import { BadRequestException, HttpException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  ApproveReviewRequest,
  CorrectTitleRequest,
  ReviewBatchRequest,
  ReviewBatchResponse,
  ReviewItem,
  ReviewListResponse,
  Resolution,
  Title,
} from '@fruiqo/contracts';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import {
  type BookAlternativeRow,
  candidateDecisions,
  isBookAlternative,
  listItems,
  lists,
  type MatchAlternativeRow,
  recommendations,
  shares,
  type RecommendationRow,
} from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';
import type { OpenLibraryResolver } from '../pipeline/resolvers/openlibrary.js';
import type { TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { CatalogService } from './catalog.service.js';
import { fitScore, type FitContext, positionReason, type QueueEntry, suggestPosition } from './fit.js';
import { loadFitContext } from './fit-context.js';
import { LibraryService } from './library.service.js';
import { OPENLIBRARY_CATALOG } from './openlibrary-catalog.js';
import { moveTitle } from './rank-queue.js';
import { columnsFromResolution } from './tmdb-enrichment.js';
import { TMDB_CATALOG } from './tmdb-catalog.js';

/**
 * RF-28/RF-42: fila de revisão. Todo import chega aqui; nada ganha posição ou entra em lista antes
 * da aprovação. Cada item traz o encaixe sugerido (posição + por quê), alternativas de match, a
 * lista proposta pelo import e um possível duplicado. Aprovar aceita ou ajusta tudo isso.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly library: LibraryService,
    @Optional() @Inject(TMDB_CATALOG) private readonly tmdb: TmdbResolver | null,
    @Optional() @Inject(OPENLIBRARY_CATALOG) private readonly books: OpenLibraryResolver | null = null,
  ) {}

  async list(userId: string): Promise<ReviewListResponse> {
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(recommendations)
        .where(eq(recommendations.decision, 'review_queue'))
        .orderBy(asc(recommendations.createdAt), asc(recommendations.sourcePosition), asc(recommendations.id));
      if (rows.length === 0) return { items: [] };
      const ids = rows.map((r) => r.id);
      const decisions = await tx
        .select()
        .from(candidateDecisions)
        .where(inArray(candidateDecisions.recommendationId, ids))
        .orderBy(asc(candidateDecisions.createdAt));
      const shareIds = [...new Set(rows.map((r) => r.shareId).filter((s): s is string => Boolean(s)))];
      const shareRows = shareIds.length ? await tx.select().from(shares).where(inArray(shares.id, shareIds)) : [];
      const proposedIds = shareRows.map((s) => s.proposedList?.listId).filter((l): l is string => Boolean(l));
      const liveLists = new Set(proposedIds.length ? (await tx.select({ id: lists.id }).from(lists).where(inArray(lists.id, proposedIds))).map((l) => l.id) : []);

      const ctx = await loadFitContext(tx);
      const cataloged = await tx.select().from(recommendations).where(eq(recommendations.decision, 'cataloged'));
      const queue = queueEntries(cataloged, ctx);
      const byExternal = new Map(cataloged.filter((c) => c.resolution?.externalId).map((c) => [c.resolution!.externalId, c]));
      const titles = await this.library.withLists(tx, rows);

      const items: ReviewItem[] = rows.map((r, i) => {
        const d = decisions.findLast((x) => x.recommendationId === r.id);
        const s = shareRows.find((x) => x.id === r.shareId);
        const fit = fitScore(fitInput(r), ctx);
        const pos = suggestPosition(fit, queue);
        const dup = r.resolution?.externalId ? byExternal.get(r.resolution.externalId) : undefined;
        const stored = r.matchAlternatives ?? [];
        const bookAlternatives = stored.filter(isBookAlternative).slice(0, 3);
        const listId = s?.proposedList?.listId && liveLists.has(s.proposedList.listId) ? s.proposedList.listId : null;
        return {
          title: titles[i]!,
          fit: {
            position: pos.position,
            total: pos.total,
            score: fit.score,
            reasons: [positionReason(pos), ...fit.reasons],
            ...(pos.before ? { before: pos.before } : {}),
          },
          alternatives: stored.filter((a): a is MatchAlternativeRow => !isBookAlternative(a)).slice(0, 3),
          ...(bookAlternatives.length ? { bookAlternatives: bookAlternatives.map(({ provider: _p, ...b }) => b) } : {}),
          proposedList: s?.proposedList ? { name: s.proposedList.name, shareId: s.id, listId } : null,
          duplicateOf: dup && dup.id !== r.id ? { id: dup.id, title: dup.title, rank: dup.rank } : null,
          candidate: d ? { rawTitle: d.rawTitle, confidenceScore: d.confidenceScore, reason: d.reason } : null,
          share: s ? { id: s.id, platform: s.platform, origin: s.origin, ...(s.sourceTitle ? { sourceTitle: s.sourceTitle } : {}) } : null,
        };
      });
      return { items };
    });
  }

  async approve(userId: string, id: string, opts: ApproveReviewRequest = {}): Promise<Title> {
    // rede (TMDB) fora da transação; a alternativa guardada serve de base se os detalhes falharem
    let alternative: Resolution | null = null;
    if (opts.alternative) {
      const alt = opts.alternative;
      const stored = await withUser(this.db, userId, async (tx) => (await this.catalog.findReview(tx, id)).matchAlternatives ?? []);
      const tmdbStored = stored.filter((a): a is MatchAlternativeRow => !isBookAlternative(a));
      alternative = await this.fetchAlternative(alt, tmdbStored.find((a) => a.tmdbId === alt.tmdbId && a.mediaType === alt.mediaType));
    } else if (opts.alternativeBook) {
      const olWorkId = opts.alternativeBook.olWorkId;
      const stored = await withUser(this.db, userId, async (tx) => (await this.catalog.findReview(tx, id)).matchAlternatives ?? []);
      alternative = await this.fetchBookAlternative(olWorkId, stored.filter(isBookAlternative).find((a) => a.olWorkId === olWorkId));
    }
    return withUser(this.db, userId, (tx) => this.approveWithin(tx, userId, id, opts, alternative));
  }

  async reject(userId: string, id: string): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const row = await this.catalog.findReview(tx, id);
      await this.catalog.logAction(tx, userId, id, 'reject', matchOf(row), { decision: 'rejected' });
      await tx.delete(recommendations).where(eq(recommendations.id, id));
    });
  }

  /** Corrigir título/ano/tipo e aprovar (entra no fim da fila e na lista proposta). */
  async rematch(userId: string, id: string, input: CorrectTitleRequest): Promise<Title> {
    return withUser(this.db, userId, async (tx) => {
      const row = await this.catalog.findReview(tx, id);
      const updated = await this.catalog.applyCorrection(tx, row, input, 'cataloged');
      await this.catalog.logAction(tx, userId, id, 'rematch', matchOf(row), matchOf(updated));
      if (row.shareId) await this.addToProposedList(tx, userId, { id, shareId: row.shareId, sourcePosition: row.sourcePosition });
      return (await this.library.withLists(tx, [await this.catalog.findTitle(tx, id)]))[0]!;
    });
  }

  /**
   * Música com título e artista trocados ("Aquarela - Toquinho" lido ao contrário): inverte
   * title/creator e mantém o item na revisão. A dedup_key é recalculada (409 se colidir).
   */
  async swapMusic(userId: string, id: string): Promise<Title> {
    return withUser(this.db, userId, async (tx) => {
      const row = await this.catalog.findReview(tx, id);
      if (!MUSIC_KINDS.has(row.kind)) throw new BadRequestException('Só dá para trocar música/artista em itens de música');
      if (!row.creator) throw new BadRequestException('Este item não tem artista para trocar');
      const updated = await this.catalog.applyCorrection(tx, row, { title: row.creator, creator: row.title }, 'review_queue');
      await this.catalog.logAction(tx, userId, id, 'correct', matchOf(row), matchOf(updated));
      return (await this.library.withLists(tx, [await this.catalog.findTitle(tx, id)]))[0]!;
    });
  }

  /**
   * Em lote: cada item na sua transação (um erro não desfaz os outros), na ordem enviada. Com `top`
   * e `end` o bloco entra nessa mesma ordem (o 1º enviado fica acima): `top` vira #1, #2, #3…
   */
  async batch(userId: string, req: ReviewBatchRequest): Promise<ReviewBatchResponse> {
    const approved: Title[] = [];
    const failed: ReviewBatchResponse['failed'] = [];
    let rejected = 0;
    for (const id of [...new Set(req.ids)]) {
      try {
        if (req.action === 'approve') approved.push(
            await this.approve(
              userId,
              id,
              req.placement === 'top' ? { position: approved.length + 1 } : req.placement ? { placement: req.placement } : {},
            ),
          );
        else {
          await this.reject(userId, id);
          rejected++;
        }
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        failed.push({ id, message: err.message });
      }
    }
    return { approved, rejected, failed };
  }

  /** Aprovação dentro de uma transação já aberta (import com approveNow, RF-46). */
  async approveWithin(tx: Tx, userId: string, id: string, opts: ApproveReviewRequest, alternative: Resolution | null): Promise<Title> {
    let row = await this.catalog.findReview(tx, id);
    const before = matchOf(row);
    const shareId = row.shareId;

    const correction: CorrectTitleRequest = {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.year !== undefined ? { year: opts.year } : {}),
      ...(opts.creator !== undefined ? { creator: opts.creator } : {}),
    };
    if (Object.keys(correction).length > 0) row = await this.catalog.applyCorrection(tx, row, correction, 'review_queue');
    if (alternative) row = await this.applyAlternative(tx, row, alternative);

    await tx
      .update(recommendations)
      .set({ decision: 'cataloged', decisionReason: 'approved', updatedAt: new Date() })
      .where(eq(recommendations.id, id));
    // o trigger pôs o título no fim da fila; agora vai para a posição escolhida/sugerida
    const placement = opts.position ? 'position' : (opts.placement ?? 'suggested');
    if (opts.position) {
      await moveTitle(tx, userId, id, { position: opts.position });
    } else if (placement === 'top') {
      await moveTitle(tx, userId, id, { to: 'top' });
    } else if (placement === 'suggested') {
      const ctx = await loadFitContext(tx);
      const others = await tx
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.decision, 'cataloged'), isNotNull(recommendations.rank), ne(recommendations.id, id)));
      const pos = suggestPosition(fitScore(fitInput(row), ctx), queueEntries(others, ctx));
      if (pos.before) await moveTitle(tx, userId, id, { position: pos.position });
    }

    for (const listId of [...new Set(opts.listIds ?? [])]) await this.catalog.appendToList(tx, userId, listId, [id]);
    if (shareId && opts.useProposedList !== false) await this.addToProposedList(tx, userId, { id, shareId, sourcePosition: row.sourcePosition });

    const final = await this.catalog.findTitle(tx, id);
    await this.catalog.logAction(tx, userId, id, 'approve', before, { ...matchOf(final), rank: final.rank, placement });
    return (await this.library.withLists(tx, [final]))[0]!;
  }

  /** Troca o match pela alternativa escolhida (TMDB ou Open Library): título, tipo, ano, gêneros e resolução. */
  private async applyAlternative(tx: Tx, row: RecommendationRow, res: Resolution): Promise<RecommendationRow> {
    const cols = columnsFromResolution(res);
    const book = res.provider === 'openlibrary';
    const next = book
      ? { kind: 'book' as RecommendationRow['kind'], title: res.title, creator: res.authors?.[0] ?? row.creator }
      : { kind: (res.mediaType === 'tv' ? 'series' : 'movie') as RecommendationRow['kind'], title: res.title, creator: row.creator };
    const key = dedupKey(next);
    if (key !== row.dedupKey) await this.catalog.assertNoClash(tx, key, row.id, true);
    const manual = row.enrichment === 'manual';
    const [updated] = await tx
      .update(recommendations)
      .set({
        ...next,
        dedupKey: key,
        resolution: res,
        resolvedAt: new Date(),
        year: cols?.year ?? row.year,
        genres: manual || !cols?.genres.length ? row.genres : cols.genres,
        runtimeMin: cols?.runtimeMin ?? row.runtimeMin,
        enrichment: manual ? 'manual' : (cols?.enrichment ?? 'tmdb'),
        matchScore: null,
        updatedAt: new Date(),
      })
      .where(eq(recommendations.id, row.id))
      .returning();
    return updated!;
  }

  private async fetchAlternative(alt: { tmdbId: number; mediaType: 'movie' | 'tv' }, stored?: MatchAlternativeRow): Promise<Resolution> {
    if (!this.tmdb) throw new BadRequestException('Catálogo de filmes e séries indisponível');
    const hint = stored
      ? {
          tmdbId: stored.tmdbId,
          mediaType: stored.mediaType,
          title: stored.title,
          ...(stored.year ? { year: stored.year } : {}),
          ...(stored.posterUrl ? { posterUrl: stored.posterUrl } : {}),
          popularity: 0,
          genreIds: [],
        }
      : undefined;
    let res: Resolution | null;
    try {
      res = await this.tmdb.byId(alt.mediaType, alt.tmdbId, hint);
    } catch {
      throw new BadRequestException('Não foi possível buscar essa opção agora');
    }
    if (!res) throw new NotFoundException('Título não encontrado no catálogo');
    return res;
  }

  /** RF-48: obra alternativa da Open Library; a alternativa guardada serve de base (sem nova busca). */
  private async fetchBookAlternative(olWorkId: string, stored?: BookAlternativeRow): Promise<Resolution> {
    if (!this.books) throw new BadRequestException('Catálogo de livros indisponível');
    const hint = stored
      ? {
          olWorkId,
          title: stored.title,
          authors: stored.authors ?? [],
          ...(stored.year ? { year: stored.year } : {}),
          ...(stored.coverUrl ? { coverUrl: stored.coverUrl } : {}),
          subjects: [],
          editionCount: 0,
        }
      : undefined;
    let res: Resolution | null;
    try {
      res = await this.books.byWorkId(olWorkId, hint);
    } catch {
      throw new BadRequestException('Não foi possível buscar essa opção agora');
    }
    if (!res) throw new NotFoundException('Livro não encontrado no catálogo');
    return res;
  }

  /**
   * Lista proposta pelo import: criada na primeira aprovação (com os títulos do post/arquivo que o
   * usuário já tinha) e, a cada aprovação, recebe o título aprovado na posição que ele tinha no
   * post. Apagada pelo usuário = não volta; item tirado da lista não é recolocado.
   */
  async addToProposedList(tx: Tx, userId: string, rec: { id: string; shareId: string; sourcePosition: number | null }): Promise<void> {
    const [share] = await tx.select({ id: shares.id, proposedList: shares.proposedList }).from(shares).where(eq(shares.id, rec.shareId));
    const proposed = share?.proposedList;
    if (!proposed) return;
    const wanted = [{ id: rec.id, pos: rec.sourcePosition ?? proposed.keys.length }];
    let listId = proposed.listId;
    if (listId) {
      const [live] = await tx.select({ id: lists.id }).from(lists).where(eq(lists.id, listId));
      if (!live) return;
    } else {
      const others = proposed.keys.length
        ? await tx
            .select({ id: recommendations.id, key: recommendations.dedupKey })
            .from(recommendations)
            .where(
              and(
                inArray(recommendations.dedupKey, proposed.keys),
                eq(recommendations.decision, 'cataloged'),
                or(isNull(recommendations.shareId), ne(recommendations.shareId, rec.shareId)),
              ),
            )
        : [];
      wanted.push(...others.map((r) => ({ id: r.id, pos: proposed.keys.indexOf(r.key) })));
      const [created] = await tx
        .insert(lists)
        .values({ userId, name: proposed.name.slice(0, 80), sourceShareId: rec.shareId })
        .returning({ id: lists.id });
      listId = created!.id;
      await tx.update(shares).set({ proposedList: { ...proposed, listId } }).where(eq(shares.id, rec.shareId));
    }
    const have = new Set((await tx.select({ id: listItems.recommendationId }).from(listItems).where(eq(listItems.listId, listId))).map((r) => r.id));
    const add = wanted.filter((w) => !have.has(w.id));
    if (add.length === 0) return;
    await tx.insert(listItems).values(add.map((w) => ({ listId: listId!, recommendationId: w.id, userId, position: w.pos })));
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
  }
}

function fitInput(r: RecommendationRow) {
  return { title: r.title, genres: r.genres, tmdbId: r.resolution?.tmdbId ?? null, mediaType: r.resolution?.mediaType ?? null };
}

export function queueEntries(rows: RecommendationRow[], ctx: FitContext): QueueEntry[] {
  return rows
    .filter((r) => r.rank != null)
    .map((r) => ({ id: r.id, title: r.title, rank: r.rank!, status: r.status, score: fitScore(fitInput(r), ctx).score }));
}

const MUSIC_KINDS = new Set<string>(['music_track', 'music_album', 'artist']);

function matchOf(r: RecommendationRow): Record<string, unknown> {
  return { title: r.title, kind: r.kind, year: r.year, creator: r.creator, decision: r.decision, dedupKey: r.dedupKey, match: r.resolution?.externalId ?? null };
}
