import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApplyPriorityDraftRequest,
  ApplyPriorityDraftResponse,
  CreatePriorityDraftRequest,
  PriorityDraft,
  UpdatePriorityDraftRequest,
} from '@fruiqo/contracts';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { bulkUndo, priorityDrafts, recommendations } from '../db/schema.js';
import { draftOrder, fitScore } from './fit.js';
import { loadFitContext } from './fit-context.js';
import { LibraryService } from './library.service.js';
import { lockQueue, restoreQueue, snapshotQueue, targetPosition } from './rank-queue.js';

const UNDO_TTL_MS = 10 * 60 * 1000;

type DraftRow = typeof priorityDrafts.$inferSelect;

/**
 * RF-44: rascunho de priorização automática. Gerar não muda a fila; o rascunho (um por usuário) é
 * editável e só vale ao aplicar, numa transação que mantém a fila contínua 1..N e devolve um token
 * de desfazer (o mesmo do /library/bulk/undo). Se a fila mudar depois do rascunho, o GET avisa e o
 * apply pede reconciliação.
 */
@Injectable()
export class PriorityDraftService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly library: LibraryService,
  ) {}

  async create(userId: string, req: CreatePriorityDraftRequest): Promise<PriorityDraft> {
    return withUser(this.db, userId, async (tx) => {
      const ctx = await loadFitContext(tx);
      const rows = await this.queueRows(tx);
      if (rows.length === 0) throw new BadRequestException('A fila está vazia');
      const order = draftOrder(
        rows.map((r) => ({
          id: r.id,
          rank: r.rank!,
          status: r.status,
          fit: fitScore({ title: r.title, genres: r.genres, tmdbId: r.resolution?.tmdbId ?? null, mediaType: r.resolution?.mediaType ?? null }, ctx),
        })),
        req.scope ?? 'to_watch',
      );
      const base = rows.map((r) => ({ id: r.id, rank: r.rank! }));
      const now = new Date();
      const [draft] = await tx
        .insert(priorityDrafts)
        .values({ userId, order, base, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: priorityDrafts.userId, set: { order, base, createdAt: now, updatedAt: now } })
        .returning();
      return this.view(tx, draft!);
    });
  }

  async get(userId: string): Promise<PriorityDraft> {
    return withUser(this.db, userId, async (tx) => this.view(tx, await this.find(tx)));
  }

  async update(userId: string, req: UpdatePriorityDraftRequest): Promise<PriorityDraft> {
    return withUser(this.db, userId, async (tx) => {
      const draft = await this.find(tx);
      const ids = draft.order.map((o) => o.id);
      let next: string[];
      if ('titleIds' in req) {
        const given = new Set(req.titleIds);
        if (given.size !== req.titleIds.length || given.size !== ids.length || ids.some((id) => !given.has(id))) {
          throw new BadRequestException('Entrada inválida: titleIds deve ter exatamente os títulos do rascunho');
        }
        next = req.titleIds;
      } else {
        const from = ids.indexOf(req.id);
        if (from < 0) throw new NotFoundException('Título fora do rascunho');
        const to = targetPosition(from + 1, ids.length, req.move) - 1;
        next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, req.id);
      }
      const byId = new Map(draft.order.map((o) => [o.id, o]));
      // item movido à mão: o motivo passa a ser a escolha do usuário
      const order = next.map((id, i) => {
        const o = byId.get(id)!;
        return ids[i] === id ? o : { ...o, reason: o.reason.startsWith('Você moveu') ? o.reason : 'Você moveu este título' };
      });
      const [updated] = await tx.update(priorityDrafts).set({ order, updatedAt: new Date() }).where(eq(priorityDrafts.userId, userId)).returning();
      return this.view(tx, updated!);
    });
  }

  async apply(userId: string, req: ApplyPriorityDraftRequest): Promise<ApplyPriorityDraftResponse> {
    return withUser(this.db, userId, async (tx) => {
      const draft = await this.find(tx);
      await lockQueue(tx, userId);
      const before = await snapshotQueue(tx, userId);
      const current = [...before].sort((a, b) => a.rank - b.rank);
      const inQueue = new Set(current.map((c) => c.id));
      const drafted = new Set(draft.order.map((o) => o.id));
      const added = current.filter((c) => !drafted.has(c.id)).map((c) => c.id);
      const removed = draft.order.filter((o) => !inQueue.has(o.id)).length;
      if ((added.length > 0 || removed > 0) && req.reconcile !== 'append_new') {
        throw new ConflictException({
          message: 'A fila mudou depois do rascunho. Aplique mantendo os títulos novos no fim ou gere outro rascunho.',
          staleDetails: { added: added.length, removed },
        });
      }
      // títulos que saíram da fila são ignorados; os que entraram vão depois do rascunho, na ordem atual
      const final = [...draft.order.map((o) => o.id).filter((id) => inQueue.has(id)), ...added];
      const target = final.map((id, i) => ({ id, rank: i + 1 }));
      const rankOf = new Map(before.map((b) => [b.id, b.rank]));
      const changed = target.filter((t) => rankOf.get(t.id) !== t.rank).length;
      if (!(await restoreQueue(tx, userId, target))) throw new ConflictException('A fila mudou durante a aplicação; tente de novo');

      const now = new Date();
      await tx.delete(bulkUndo).where(lt(bulkUndo.expiresAt, now));
      const expiresAt = new Date(now.getTime() + UNDO_TTL_MS);
      const [undo] = await tx
        .insert(bulkUndo)
        .values({ userId, operation: 'priority_draft', snapshot: { type: 'queue', ranks: before }, expiresAt })
        .returning({ id: bulkUndo.id });
      await tx.delete(priorityDrafts).where(eq(priorityDrafts.userId, userId));
      return { applied: changed, undoToken: undo!.id, undoExpiresAt: expiresAt.toISOString() };
    });
  }

  async discard(userId: string): Promise<void> {
    const deleted = await withUser(this.db, userId, (tx) => tx.delete(priorityDrafts).where(eq(priorityDrafts.userId, userId)).returning({ userId: priorityDrafts.userId }));
    if (deleted.length === 0) throw new NotFoundException('Nenhum rascunho de prioridade');
  }

  private async find(tx: Tx): Promise<DraftRow> {
    const [draft] = await tx.select().from(priorityDrafts);
    if (!draft) throw new NotFoundException('Nenhum rascunho de prioridade');
    return draft;
  }

  private queueRows(tx: Tx) {
    return tx
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.decision, 'cataloged'), isNotNull(recommendations.rank)))
      .orderBy(recommendations.rank);
  }

  private async view(tx: Tx, draft: DraftRow): Promise<PriorityDraft> {
    const rows = await this.queueRows(tx);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const present = draft.order.filter((o) => byId.has(o.id));
    const titles = new Map((await this.library.withLists(tx, present.map((o) => byId.get(o.id)!))).map((t) => [t.id, t]));
    const drafted = new Set(draft.order.map((o) => o.id));
    const added = rows.filter((r) => !drafted.has(r.id)).length;
    const removed = draft.order.length - present.length;
    const baseOrder = [...draft.base].sort((a, b) => a.rank - b.rank).map((b) => b.id).join(',');
    const reordered = rows.map((r) => r.id).join(',') !== baseOrder;
    return {
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
      items: present.map((o, i) => {
        const currentRank = byId.get(o.id)!.rank;
        return {
          title: titles.get(o.id)!,
          currentRank,
          proposedRank: i + 1,
          delta: currentRank == null ? 0 : currentRank - (i + 1),
          reason: o.reason,
          score: o.score,
        };
      }),
      stale: added > 0 || removed > 0 || reordered,
      ...(added > 0 || removed > 0 || reordered ? { staleDetails: { added, removed } } : {}),
    };
  }
}
