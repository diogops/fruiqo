import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityItem,
  ActivityResponse,
  BulkRequest,
  BulkResponse,
  BulkUndoResponse,
  CorrectTitleRequest,
  CreateTitleRequest,
  ListDetail,
  MoodHistoryResponse,
  ReviewItem,
  ReviewListResponse,
  SubscriptionsResponse,
  TasteEntry,
  TasteProfile,
  Title,
  UpdateListRequest,
  UpdateTasteRequest,
  UpdateUserSettingsRequest,
  UserSettings,
} from '@fruiqo/contracts';
import { TASTE_LEVEL_SCORE, type TasteLevel } from '@fruiqo/contracts';
import { GENRES, GENRE_KEYS, type GenreKey, interpretTasteStatement, SUBGENRES } from '@fruiqo/taxonomy';
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import {
  bulkUndo,
  candidateDecisions,
  listItems,
  lists,
  pipelineStepLogs,
  recommendationFeedback,
  recommendationRuns,
  recommendations,
  reviewActions,
  shares,
  tasteFavorites,
  overrideScore,
  tasteOverrides,
  tasteSignals,
  tasteStatements,
  tasteSubgenrePrefs,
  userSettings,
  userSubscriptions,
  type RecommendationRow,
} from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';
import { LibraryService } from './library.service.js';
import { declaredAffinity } from './fit.js';
import { NEED_LABEL, tasteFromSignals } from './ranking.js';
import { moveTitle, moveToEdge, type RankSnapshot, restoreQueue, snapshotQueue } from './rank-queue.js';
import { STREAMING_PROVIDERS } from './providers.js';
import { readSettings, toSettingsView } from './user-settings.js';

// Fase 2c (sistema web): catálogo em massa, correção/merge, fila de revisão, activity log e perfil.
// Tudo passa por withUser (RLS); nenhum texto de terceiros ou de humor é logado.

const GENRE_SET = new Set<string>(GENRE_KEYS);
const GENRE_LABEL = new Map(GENRES.map((g) => [g.key, g.label]));
const SUBGENRE_SET = new Set<string>(SUBGENRES.map((s) => s.key));
const LEVELS = Object.entries(TASTE_LEVEL_SCORE) as [TasteLevel, number][];

/** Nível mais próximo de um override (pin = adoro, exclude = detesto). */
function levelOf(o: { mode: 'pin' | 'exclude' | 'level'; score: number | null }): TasteLevel {
  const v = overrideScore(o);
  return LEVELS.reduce((best, cur) => (Math.abs(cur[1] - v) < Math.abs(best[1] - v) ? cur : best))[0];
}
const UNDO_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_PAGE = 30;
const STATUS_ORDER = { catalog: -1, to_watch: 0, watching: 1, watched: 2, dropped: 2 } as const;

export { STREAMING_PROVIDERS } from './providers.js';
const PROVIDER_SET = new Set<string>(STREAMING_PROVIDERS.map((p) => p.key));

type Kind = RecommendationRow['kind'];
type Snapshot =
  | { type: 'list_add'; listId: string; added: string[] }
  | { type: 'list_remove'; rows: { listId: string; recommendationId: string; position: number; addedAt: string }[] }
  | { type: 'list_move'; removed: { listId: string; recommendationId: string; position: number; addedAt: string }[]; toListId: string; added: string[] }
  | { type: 'fields'; rows: { id: string; genres?: string[]; enrichment?: RecommendationRow['enrichment']; status?: RecommendationRow['status'] }[]; signalIds: string[] }
  | { type: 'queue'; ranks: RankSnapshot }
  | { type: 'delete'; rows: Record<string, unknown>[]; items: { listId: string; recommendationId: string; position: number; addedAt: string }[] };

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------- D-08: preferências de privacidade (SEC-CTRL-50/51) ----------

  async getSettings(userId: string): Promise<UserSettings> {
    return withUser(this.db, userId, async (tx) => toSettingsView(await readSettings(tx), this.env));
  }

  async updateSettings(userId: string, patch: UpdateUserSettingsRequest): Promise<UserSettings> {
    return withUser(this.db, userId, async (tx) => {
      const current = await readSettings(tx);
      const rememberMood = patch.rememberMood ?? current.rememberMood;
      const aiConsent = patch.aiConsent ?? current.aiConsent;
      // a data do aceite muda só quando o consentimento passa de false para true
      const aiConsentAt = aiConsent ? (current.aiConsent ? current.aiConsentAt : new Date()) : null;
      const now = new Date();
      await tx
        .insert(userSettings)
        .values({ userId, rememberMood, aiConsent, aiConsentAt, updatedAt: now })
        .onConflictDoUpdate({ target: userSettings.userId, set: { rememberMood, aiConsent, aiConsentAt, updatedAt: now } });
      // desligar "lembrar meu humor" apaga as intenções já guardadas (o usuário não quer mais retê-las)
      if (patch.rememberMood === false && current.rememberMood) {
        await tx.update(recommendationRuns).set({ intent: null }).where(eq(recommendationRuns.mode, 'mood'));
      }
      return toSettingsView({ rememberMood, aiConsent, aiConsentAt }, this.env);
    });
  }

  // ---------- RF-24: adicionar manualmente ----------

  async createTitle(userId: string, input: CreateTitleRequest): Promise<Title> {
    const genres = this.validGenres(input.genres);
    return withUser(this.db, userId, async (tx) => {
      const key = dedupKey({ kind: input.kind, title: input.title, creator: input.creator ?? null });
      await this.assertNoClash(tx, key, null, false);
      const [row] = await tx
        .insert(recommendations)
        .values({
          userId,
          shareId: null,
          kind: input.kind,
          title: input.title,
          creator: input.creator ?? null,
          year: input.year ?? null,
          confidence: 1,
          extractor: 'heuristic',
          dedupKey: key,
          decision: 'cataloged',
          decisionReason: 'manual',
          status: input.status ?? 'to_watch',
          // posição: fim da fila (trigger recommendations_assign_rank)
          genres,
          enrichment: genres.length > 0 ? 'manual' : 'none',
        })
        .returning();
      if (input.listId) await this.appendToList(tx, userId, input.listId, [row!.id]);
      return (await this.library.withLists(tx, [row!]))[0]!;
    });
  }

  // ---------- RF-25: edição em massa + desfazer ----------

  async bulk(userId: string, req: BulkRequest): Promise<BulkResponse> {
    const ids = [...new Set(req.titleIds)];
    const op = req.operation;
    if ((op.type === 'add_genres' || op.type === 'remove_genres') && op.genres.some((g) => !GENRE_SET.has(g))) {
      throw new BadRequestException('Entrada inválida: genres');
    }
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(recommendations)
        .where(and(inArray(recommendations.id, ids), eq(recommendations.decision, 'cataloged')));
      if (rows.length !== ids.length) throw new BadRequestException('Entrada inválida: titleIds');
      const now = new Date();
      let snapshot: Snapshot;

      switch (op.type) {
        case 'add_to_list': {
          const added = await this.appendToList(tx, userId, op.listId, ids);
          snapshot = { type: 'list_add', listId: op.listId, added };
          break;
        }
        case 'remove_from_list': {
          await this.assertList(tx, op.listId);
          snapshot = { type: 'list_remove', rows: await this.removeFromList(tx, op.listId, ids) };
          break;
        }
        case 'move_to_list': {
          if (op.fromListId === op.toListId) throw new BadRequestException('Entrada inválida: listas iguais');
          await this.assertList(tx, op.fromListId);
          const removed = await this.removeFromList(tx, op.fromListId, ids);
          const added = await this.appendToList(tx, userId, op.toListId, ids);
          snapshot = { type: 'list_move', removed, toListId: op.toListId, added };
          break;
        }
        case 'add_genres':
        case 'remove_genres': {
          for (const r of rows) {
            const next =
              op.type === 'add_genres'
                ? [...new Set([...r.genres, ...op.genres])]
                : r.genres.filter((g) => !op.genres.includes(g));
            await tx.update(recommendations).set({ genres: next, enrichment: 'manual', updatedAt: now }).where(eq(recommendations.id, r.id));
          }
          snapshot = { type: 'fields', rows: rows.map((r) => ({ id: r.id, genres: r.genres, enrichment: r.enrichment })), signalIds: [] };
          break;
        }
        case 'move_top':
        case 'move_bottom': {
          const before = await snapshotQueue(tx, userId);
          await moveToEdge(tx, userId, ids, op.type === 'move_top' ? 'top' : 'bottom');
          snapshot = { type: 'queue', ranks: before };
          break;
        }
        case 'set_status': {
          await tx.update(recommendations).set({ status: op.status, updatedAt: now }).where(inArray(recommendations.id, ids));
          // RF-34: mesmos sinais do PATCH, só para quem mudou de fato
          const signal: 'watched' | 'dropped' | null = op.status === 'watched' ? 'watched' : op.status === 'dropped' ? 'dropped' : null;
          const changed = rows.filter((r) => r.status !== op.status).map((r) => r.id);
          const inserted =
            signal && changed.length > 0
              ? await tx
                  .insert(tasteSignals)
                  .values(changed.map((recommendationId) => ({ userId, recommendationId, signal })))
                  .returning({ id: tasteSignals.id })
              : [];
          snapshot = { type: 'fields', rows: rows.map((r) => ({ id: r.id, status: r.status })), signalIds: inserted.map((s) => s.id) };
          break;
        }
        case 'delete': {
          const items = await tx.select().from(listItems).where(inArray(listItems.recommendationId, ids));
          await tx.delete(recommendations).where(inArray(recommendations.id, ids));
          snapshot = {
            type: 'delete',
            rows: rows.map((r) => ({ ...r })) as Record<string, unknown>[],
            items: items.map((i) => ({ listId: i.listId, recommendationId: i.recommendationId, position: i.position, addedAt: i.addedAt.toISOString() })),
          };
          break;
        }
      }

      if (op.type !== 'delete') await this.library.touchListsOf(tx, ids, now);
      await tx.delete(bulkUndo).where(lt(bulkUndo.expiresAt, now));
      const expiresAt = new Date(now.getTime() + UNDO_TTL_MS);
      const [undo] = await tx
        .insert(bulkUndo)
        .values({ userId, operation: op.type, snapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>, expiresAt })
        .returning({ id: bulkUndo.id });
      return { affected: ids.length, undoToken: undo!.id, undoExpiresAt: expiresAt.toISOString() };
    });
  }

  async undo(userId: string, token: string): Promise<BulkUndoResponse> {
    return withUser(this.db, userId, async (tx) => {
      const [row] = await tx
        .delete(bulkUndo)
        .where(and(eq(bulkUndo.id, token), gt(bulkUndo.expiresAt, new Date())))
        .returning();
      if (!row) throw new NotFoundException('Não é mais possível desfazer');
      const snap = row.snapshot as unknown as Snapshot;
      const now = new Date();
      try {
        switch (snap.type) {
          case 'list_add':
            if (snap.added.length > 0) {
              await tx.delete(listItems).where(and(eq(listItems.listId, snap.listId), inArray(listItems.recommendationId, snap.added)));
            }
            return { restored: snap.added.length };
          case 'list_remove':
            await this.reinsertItems(tx, userId, snap.rows);
            return { restored: snap.rows.length };
          case 'list_move':
            if (snap.added.length > 0) {
              await tx.delete(listItems).where(and(eq(listItems.listId, snap.toListId), inArray(listItems.recommendationId, snap.added)));
            }
            await this.reinsertItems(tx, userId, snap.removed);
            return { restored: snap.removed.length };
          case 'fields':
            for (const r of snap.rows) {
              await tx
                .update(recommendations)
                .set({
                  ...(r.genres ? { genres: r.genres } : {}),
                  ...(r.enrichment ? { enrichment: r.enrichment } : {}),
                  ...(r.status ? { status: r.status } : {}),
                  updatedAt: now,
                })
                .where(eq(recommendations.id, r.id));
            }
            if (snap.signalIds.length > 0) await tx.delete(tasteSignals).where(inArray(tasteSignals.id, snap.signalIds));
            return { restored: snap.rows.length };
          case 'queue':
            if (!(await restoreQueue(tx, userId, snap.ranks))) {
              throw new ConflictException('Não é mais possível desfazer: a fila mudou depois da edição');
            }
            return { restored: snap.ranks.length };
          case 'delete': {
            // voltam para o fim da fila (trigger) e depois para a posição que tinham, do topo para baixo
            const values = snap.rows.map((r) => ({ ...reviveRow(r), rank: null }));
            if (values.length > 0) await tx.insert(recommendations).values(values);
            const positions = snap.rows
              .map((r) => ({ id: String(r.id), rank: typeof r.rank === 'number' ? r.rank : null }))
              .filter((r): r is { id: string; rank: number } => r.rank !== null)
              .sort((a, b) => a.rank - b.rank);
            for (const p of positions) await moveTitle(tx, userId, p.id, { position: p.rank });
            await this.reinsertItems(tx, userId, snap.items);
            return { restored: values.length };
          }
        }
      } catch (err) {
        // título recriado com a mesma chave, share/lista apagados depois: não dá para voltar
        if (pgCode(err) === '23505' || pgCode(err) === '23503') {
          throw new ConflictException('Não é mais possível desfazer: os dados mudaram depois da edição');
        }
        throw err;
      }
    });
  }

  // ---------- RF-26: listas ----------

  async updateList(userId: string, id: string, input: UpdateListRequest): Promise<ListDetail> {
    return withUser(this.db, userId, async (tx) => {
      await this.assertList(tx, id);
      await tx
        .update(lists)
        .set({ ...(input.name ? { name: input.name } : {}), ...(input.pinned !== undefined ? { pinned: input.pinned } : {}), updatedAt: new Date() })
        .where(eq(lists.id, id));
      return this.library.detail(tx, id);
    });
  }

  async duplicateList(userId: string, id: string, name?: string): Promise<ListDetail> {
    return withUser(this.db, userId, async (tx) => {
      const source = await this.assertList(tx, id);
      const [copy] = await tx
        .insert(lists)
        .values({ userId, name: name ?? `${source.name} (cópia)`.slice(0, 80) })
        .returning({ id: lists.id });
      const items = await tx.select().from(listItems).where(eq(listItems.listId, id)).orderBy(asc(listItems.position));
      if (items.length > 0) {
        await tx.insert(listItems).values(items.map((i) => ({ listId: copy!.id, recommendationId: i.recommendationId, userId, position: i.position })));
      }
      return this.library.detail(tx, copy!.id);
    });
  }

  // ---------- RF-19/27: activity log ----------

  async activity(userId: string, cursor?: string): Promise<ActivityResponse> {
    const after = cursor ? decodeKeyset(cursor) : null;
    if (cursor && !after) throw new BadRequestException('Entrada inválida: cursor');
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(shares)
        .where(
          after
            ? or(lt(shares.createdAt, after.createdAt), and(eq(shares.createdAt, after.createdAt), lt(shares.id, after.id)))
            : undefined,
        )
        .orderBy(desc(shares.createdAt), desc(shares.id))
        .limit(ACTIVITY_PAGE + 1);
      const page = rows.slice(0, ACTIVITY_PAGE);
      const ids = page.map((r) => r.id);
      const counts = ids.length
        ? await tx
            .select({ shareId: candidateDecisions.shareId, decision: candidateDecisions.decision, n: sql<number>`count(*)::int` })
            .from(candidateDecisions)
            .where(inArray(candidateDecisions.shareId, ids))
            .groupBy(candidateDecisions.shareId, candidateDecisions.decision)
        : [];
      const steps = ids.length
        ? await tx.select().from(pipelineStepLogs).where(inArray(pipelineStepLogs.shareId, ids)).orderBy(asc(pipelineStepLogs.seq))
        : [];
      const items: ActivityItem[] = page.map((s) => {
        const mine = steps.filter((st) => st.shareId === s.id);
        const count = (d: string) => counts.find((c) => c.shareId === s.id && c.decision === d)?.n ?? 0;
        return {
          shareId: s.id,
          status: s.status,
          origin: s.origin,
          platform: s.platform,
          ...(s.sourceTitle ? { sourceTitle: s.sourceTitle } : {}),
          ...(s.sourceUrl ? { sourceUrl: s.sourceUrl } : {}),
          ...(s.pageCount != null ? { pageCount: s.pageCount } : {}),
          isFixture: s.isFixture,
          ...(s.error ? { error: s.error } : {}),
          dedup: { pagesIgnored: s.pagesIgnored, itemsAlreadyInList: s.itemsAlreadyInList },
          counts: { cataloged: count('cataloged'), review: count('review_queue'), discarded: count('discarded') },
          steps: mine.map((st) => ({ step: st.step, durationMs: st.durationMs, ...(st.error ? { error: st.error } : {}) })),
          durationMs: mine.reduce((sum, st) => sum + st.durationMs, 0),
          costEstimateUsd: mine.reduce((sum, st) => sum + st.costEstimateUsd, 0),
          createdAt: s.createdAt.toISOString(),
        };
      });
      const last = page[page.length - 1];
      return { items, nextCursor: rows.length > ACTIVITY_PAGE && last ? encodeKeyset(last.createdAt, last.id) : null };
    });
  }

  // ---------- RF-27: correção e merge ----------

  async correct(userId: string, id: string, input: CorrectTitleRequest): Promise<Title> {
    return withUser(this.db, userId, async (tx) => {
      const row = await this.findTitle(tx, id);
      const updated = await this.applyCorrection(tx, row, input, row.decision);
      await this.logAction(tx, userId, id, 'correct', pickMatch(row), pickMatch(updated));
      return (await this.library.withLists(tx, [updated]))[0]!;
    });
  }

  /** Junta `id` em `intoId`: listas, sinais, feedback e decisões passam para o destino; o resto é preenchido. */
  async merge(userId: string, id: string, intoId: string): Promise<Title> {
    if (id === intoId) throw new BadRequestException('Entrada inválida: intoId');
    return withUser(this.db, userId, async (tx) => {
      const source = await this.findTitle(tx, id);
      const target = await this.findTitle(tx, intoId);

      const srcItems = await tx.select().from(listItems).where(eq(listItems.recommendationId, id));
      const tgtLists = new Set(
        (await tx.select({ listId: listItems.listId }).from(listItems).where(eq(listItems.recommendationId, intoId))).map((r) => r.listId),
      );
      for (const item of srcItems) {
        if (tgtLists.has(item.listId)) continue;
        await tx.insert(listItems).values({ listId: item.listId, recommendationId: intoId, userId, position: item.position });
      }
      await tx.update(tasteSignals).set({ recommendationId: intoId }).where(eq(tasteSignals.recommendationId, id));
      await tx.update(recommendationFeedback).set({ recommendationId: intoId }).where(eq(recommendationFeedback.recommendationId, id));
      await tx.update(candidateDecisions).set({ recommendationId: intoId }).where(eq(candidateDecisions.recommendationId, id));

      const genres = [...new Set([...target.genres, ...source.genres])];
      const status = STATUS_ORDER[source.status] > STATUS_ORDER[target.status] ? source.status : target.status;
      const [merged] = await tx
        .update(recommendations)
        .set({
          genres,
          enrichment: target.enrichment === 'none' ? source.enrichment : target.enrichment,
          status,
          rating: target.rating ?? source.rating,
          notes: target.notes ?? source.notes,
          year: target.year ?? source.year,
          creator: target.creator ?? source.creator,
          runtimeMin: target.runtimeMin ?? source.runtimeMin,
          resolution: target.resolution ?? source.resolution,
          resolvedAt: target.resolution ? target.resolvedAt : source.resolvedAt,
          updatedAt: new Date(),
        })
        .where(eq(recommendations.id, intoId))
        .returning();
      await this.logAction(tx, userId, intoId, 'merge', { mergedFrom: pickMatch(source) }, pickMatch(merged!));
      await tx.delete(recommendations).where(eq(recommendations.id, id));
      // o título mesclado fica com a melhor posição dos dois (a remoção já fechou o buraco)
      if (source.rank != null && target.rank != null && source.rank < target.rank) {
        await moveTitle(tx, userId, intoId, { position: source.rank });
      }
      const final = await this.findTitle(tx, intoId);
      return (await this.library.withLists(tx, [final]))[0]!;
    });
  }

  // ---------- RF-29/RNF-10: perfil de gosto ----------

  async taste(userId: string): Promise<TasteProfile> {
    return withUser(this.db, userId, (tx) => this.buildTaste(tx));
  }

  async updateTaste(userId: string, input: UpdateTasteRequest): Promise<TasteProfile> {
    const levels = input.levels ?? [];
    const all = [...(input.exclude ?? []), ...(input.pin ?? []), ...(input.clear ?? []), ...levels.map((l) => l.key)];
    if (all.some((g) => !GENRE_SET.has(g))) throw new BadRequestException('Entrada inválida: genre');
    if ((input.subgenres ?? []).some((s) => !SUBGENRE_SET.has(s.key))) throw new BadRequestException('Entrada inválida: subgenre');
    const pin = new Set(input.pin ?? []);
    if ((input.exclude ?? []).some((g) => pin.has(g))) throw new BadRequestException('Entrada inválida: gênero fixado e excluído');
    return withUser(this.db, userId, async (tx) => {
      if (input.clear?.length) await tx.delete(tasteOverrides).where(inArray(tasteOverrides.genre, input.clear));
      // adoro = fixar e detesto = excluir (nunca sugerido); os níveis do meio guardam o valor
      const upserts = [
        ...(input.exclude ?? []).map((genre) => ({ genre, mode: 'exclude' as const, score: null })),
        ...(input.pin ?? []).map((genre) => ({ genre, mode: 'pin' as const, score: null })),
        ...levels.map(({ key, level }) =>
          level === 'love'
            ? { genre: key, mode: 'pin' as const, score: null }
            : level === 'hate'
              ? { genre: key, mode: 'exclude' as const, score: null }
              : { genre: key, mode: 'level' as const, score: TASTE_LEVEL_SCORE[level] },
        ),
      ];
      for (const u of upserts) {
        await tx
          .insert(tasteOverrides)
          .values({ userId, ...u })
          .onConflictDoUpdate({ target: [tasteOverrides.userId, tasteOverrides.genre], set: { mode: u.mode, score: u.score, createdAt: new Date() } });
      }
      for (const { key, pref } of input.subgenres ?? []) {
        if (pref === null) await tx.delete(tasteSubgenrePrefs).where(eq(tasteSubgenrePrefs.subgenre, key));
        else
          await tx
            .insert(tasteSubgenrePrefs)
            .values({ userId, subgenre: key, pref })
            .onConflictDoUpdate({ target: [tasteSubgenrePrefs.userId, tasteSubgenrePrefs.subgenre], set: { pref, createdAt: new Date() } });
      }
      return this.buildTaste(tx);
    });
  }

  async subscriptions(userId: string): Promise<SubscriptionsResponse> {
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx.select().from(userSubscriptions);
      return { available: [...STREAMING_PROVIDERS], selected: rows.map((r) => r.provider).sort() };
    });
  }

  async setSubscriptions(userId: string, providers: string[]): Promise<SubscriptionsResponse> {
    const unique = [...new Set(providers)];
    if (unique.some((p) => !PROVIDER_SET.has(p))) throw new BadRequestException('Entrada inválida: providers');
    return withUser(this.db, userId, async (tx) => {
      await tx.delete(userSubscriptions);
      if (unique.length > 0) await tx.insert(userSubscriptions).values(unique.map((provider) => ({ userId, provider })));
      return { available: [...STREAMING_PROVIDERS], selected: unique.sort() };
    });
  }

  /** RNF-06: só intenções estruturadas; o texto do "Como estou" nunca foi guardado. */
  async moodHistory(userId: string): Promise<MoodHistoryResponse> {
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(recommendationRuns)
        // só o que foi lembrado (SEC-CTRL-50): runs sem intenção não viram histórico
        .where(and(eq(recommendationRuns.mode, 'mood'), sql`${recommendationRuns.intent} is not null`))
        .orderBy(desc(recommendationRuns.createdAt))
        .limit(100);
      return {
        items: rows.map((r) => {
          const intent = (r.intent ?? {}) as { need?: string; avoid?: string[] };
          const need = typeof intent.need === 'string' ? intent.need : undefined;
          return {
            runId: r.id,
            createdAt: r.createdAt.toISOString(),
            ...(need ? { need, needLabel: (NEED_LABEL as Record<string, string>)[need] ?? need } : {}),
            avoid: Array.isArray(intent.avoid) ? intent.avoid.filter((a): a is string => typeof a === 'string') : [],
            riskShown: r.riskShown,
          };
        }),
      };
    });
  }

  async deleteMoodHistory(userId: string): Promise<void> {
    await withUser(this.db, userId, (tx) => tx.delete(recommendationRuns).where(eq(recommendationRuns.mode, 'mood')));
  }

  // ---------- internos (os públicos daqui também servem ao ReviewService) ----------

  private async buildTaste(tx: Tx): Promise<TasteProfile> {
    const titles = await tx.select({ id: recommendations.id, genres: recommendations.genres, status: recommendations.status, rating: recommendations.rating }).from(recommendations);
    const genresOf = new Map(titles.map((t) => [t.id, t.genres.filter((g): g is GenreKey => GENRE_SET.has(g))]));
    const rows = await tx.select().from(tasteSignals);
    const usable = rows.filter((r) => r.recommendationId && genresOf.has(r.recommendationId));
    const scores = tasteFromSignals(usable.map((r) => ({ signal: r.signal, value: r.value, genres: genresOf.get(r.recommendationId!)! })));
    const signalCount = new Map<string, number>();
    for (const r of usable) for (const g of genresOf.get(r.recommendationId!)!) signalCount.set(g, (signalCount.get(g) ?? 0) + 1);
    const overrides = await tx.select().from(tasteOverrides);
    const overrideOf = new Map(overrides.map((o) => [o.genre, o]));

    // RF-43: perfil declarado (favoritos + resumo) aparece ao lado dos sinais, sem apagá-los
    const [statement] = await tx.select().from(tasteStatements);
    const declared = declaredAffinity(await tx.select().from(tasteFavorites), statement?.summary ? interpretTasteStatement(statement.summary) : null);

    const genres: TasteEntry[] = GENRE_KEYS.filter((g) => signalCount.has(g) || overrideOf.has(g) || declared.has(g))
      .map((g) => {
        const o = overrideOf.get(g);
        const decl = declared.get(g)?.score;
        return {
          key: g,
          label: GENRE_LABEL.get(g) ?? g,
          score: o ? overrideScore(o) : (scores[g] ?? 0),
          source: !o ? ('signals' as const) : o.mode === 'pin' ? ('pinned' as const) : o.mode === 'exclude' ? ('excluded' as const) : ('manual' as const),
          signals: signalCount.get(g) ?? 0,
          ...(o ? { level: levelOf(o), learnedScore: scores[g] ?? 0 } : {}),
          ...(decl !== undefined ? { declaredScore: decl } : {}),
        };
      })
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    const scoreOf = new Map(genres.map((g) => [g.key, g.score]));
    const prefOf = new Map((await tx.select().from(tasteSubgenrePrefs)).map((p) => [p.subgenre, p.pref]));
    // subgênero: média das afinidades dos gêneros que a regra dele cita (aproximação transparente);
    // com preferência manual, aparece mesmo sem gênero aprendido
    type Sub = TasteProfile['subgenres'][number];
    const subgenres = SUBGENRES.map((s): Sub | null => {
      const keys = [...(s.rule.all ?? []), ...(s.rule.anyOf ?? []).flat()].filter((g) => scoreOf.has(g));
      const pref = prefOf.get(s.key);
      if (keys.length === 0 && !pref) return null;
      const score = keys.length > 0 ? keys.reduce((sum, g) => sum + scoreOf.get(g)!, 0) / keys.length : 0;
      return { key: s.key, label: s.label, score: Math.round(score * 1000) / 1000, ...(pref ? { pref } : {}) };
    })
      .filter((s): s is Sub => s !== null)
      .sort((a, b) => b.score - a.score);

    return {
      genres,
      subgenres,
      overrides: {
        pinned: overrides.filter((o) => o.mode === 'pin').map((o) => o.genre).sort(),
        excluded: overrides.filter((o) => o.mode === 'exclude').map((o) => o.genre).sort(),
      },
      totals: {
        signals: rows.length,
        watched: titles.filter((t) => t.status === 'watched').length,
        rated: titles.filter((t) => t.rating != null).length,
      },
    };
  }

  async applyCorrection(
    tx: Tx,
    row: RecommendationRow,
    input: CorrectTitleRequest,
    decision: RecommendationRow['decision'],
  ): Promise<RecommendationRow> {
    const next = {
      kind: (input.kind ?? row.kind) as Kind,
      title: input.title ?? row.title,
      creator: input.creator === undefined ? row.creator : input.creator,
    };
    const key = dedupKey(next);
    if (key !== row.dedupKey) await this.assertNoClash(tx, key, row.id, true);
    const [updated] = await tx
      .update(recommendations)
      .set({
        kind: next.kind,
        title: next.title,
        creator: next.creator,
        ...(input.year !== undefined ? { year: input.year } : {}),
        dedupKey: key,
        decision,
        ...(decision !== row.decision ? { decisionReason: 'rematched' } : {}),
        // o match mudou: resolução antiga (TMDB/Spotify) não vale mais para o título novo
        ...(input.title || input.kind ? { resolution: null, resolvedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(recommendations.id, row.id))
      .returning();
    return updated!;
  }

  async assertNoClash(tx: Tx, key: string, selfId: string | null, suggestMerge: boolean) {
    const [clash] = await tx.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.dedupKey, key));
    if (clash && clash.id !== selfId) {
      throw new ConflictException({
        message: 'Já existe um título igual na sua lista',
        conflictWith: clash.id,
        ...(suggestMerge ? { suggestion: 'merge' } : {}),
      });
    }
  }

  async logAction(
    tx: Tx,
    userId: string,
    recommendationId: string,
    action: (typeof reviewActions.$inferInsert)['action'],
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    await tx.insert(reviewActions).values({ userId, recommendationId, action, before, after });
  }

  async findTitle(tx: Tx, id: string): Promise<RecommendationRow> {
    const [row] = await tx.select().from(recommendations).where(eq(recommendations.id, id));
    if (!row) throw new NotFoundException('Título não encontrado');
    return row;
  }

  async findReview(tx: Tx, id: string): Promise<RecommendationRow> {
    const row = await this.findTitle(tx, id);
    if (row.decision !== 'review_queue') throw new ConflictException('O título não está na fila de revisão');
    return row;
  }

  private async assertList(tx: Tx, id: string) {
    const [row] = await tx.select().from(lists).where(eq(lists.id, id));
    if (!row) throw new NotFoundException('Lista não encontrada');
    return row;
  }

  /** Acrescenta ao fim da lista só quem ainda não está nela; devolve os ids adicionados. */
  async appendToList(tx: Tx, userId: string, listId: string, ids: string[]): Promise<string[]> {
    await this.assertList(tx, listId);
    const existing = await tx.select().from(listItems).where(eq(listItems.listId, listId));
    const had = new Set(existing.map((e) => e.recommendationId));
    const add = ids.filter((i) => !had.has(i));
    if (add.length === 0) return [];
    const start = existing.reduce((m, e) => Math.max(m, e.position + 1), 0);
    await tx.insert(listItems).values(add.map((recommendationId, i) => ({ listId, recommendationId, userId, position: start + i })));
    await tx.insert(tasteSignals).values(add.map((recommendationId) => ({ userId, recommendationId, signal: 'added_to_list' as const })));
    await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, listId));
    return add;
  }

  private async removeFromList(tx: Tx, listId: string, ids: string[]) {
    const removed = await tx
      .delete(listItems)
      .where(and(eq(listItems.listId, listId), inArray(listItems.recommendationId, ids)))
      .returning();
    return removed.map((r) => ({ listId: r.listId, recommendationId: r.recommendationId, position: r.position, addedAt: r.addedAt.toISOString() }));
  }

  private async reinsertItems(tx: Tx, userId: string, rows: { listId: string; recommendationId: string; position: number; addedAt: string }[]) {
    if (rows.length === 0) return;
    await tx
      .insert(listItems)
      .values(rows.map((r) => ({ listId: r.listId, recommendationId: r.recommendationId, userId, position: r.position, addedAt: new Date(r.addedAt) })))
      .onConflictDoNothing();
  }

  private validGenres(genres: string[] | undefined): string[] {
    const unique = [...new Set(genres ?? [])];
    if (unique.some((g) => !GENRE_SET.has(g))) throw new BadRequestException('Entrada inválida: genres');
    return unique;
  }
}

function pickMatch(r: RecommendationRow): Record<string, unknown> {
  return { title: r.title, kind: r.kind, year: r.year, creator: r.creator, decision: r.decision, dedupKey: r.dedupKey };
}

/** Linha de recommendations serializada no snapshot (datas viraram string no JSON). */
function reviveRow(r: Record<string, unknown>): typeof recommendations.$inferInsert {
  const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null);
  return {
    ...(r as unknown as typeof recommendations.$inferInsert),
    createdAt: date(r.createdAt) ?? new Date(),
    updatedAt: date(r.updatedAt) ?? new Date(),
    resolvedAt: date(r.resolvedAt),
  };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

function encodeKeyset(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeKeyset(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { createdAt, id };
}
