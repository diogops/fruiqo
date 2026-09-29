import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateShareRequest, Share, ShareListResponse, ShareStepsResponse } from '@fruiqo/contracts';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { candidateDecisions, pipelineStepLogs, recommendations, shares } from '../db/schema.js';
import { SHARE_QUEUE_TOKEN, type ShareJob } from '../queue/queue.js';
import { toDecision, toShare, toStep } from './share-mapper.js';

const PAGE_SIZE = 20;

@Injectable()
export class SharesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SHARE_QUEUE_TOKEN) private readonly queue: Queue<ShareJob>,
  ) {}

  /** Idempotente por (usuário, clientShareId): retries do app devolvem o mesmo share. */
  /**
   * `fixture`: share criado pelo sandbox/eval (só fora de produção, validado no controller); guarda
   * os trechos de texto nos logs de etapa (RF-19).
   */
  async create(
    userId: string,
    input: CreateShareRequest,
    fixture?: string,
  ): Promise<{ share: Share; created: boolean }> {
    const { row, created } = await withUser(this.db, userId, async (tx) => {
      const inserted = await tx
        .insert(shares)
        .values({
          userId,
          clientShareId: input.clientShareId,
          status: 'queued',
          inputText: input.text ?? null,
          inputUrl: input.url ?? null,
          ...(fixture ? { isFixture: true, fixtureId: fixture } : {}),
          // prints: OCR feito no device; plataforma não é inferida do texto
          ...(input.pages
            ? { inputPages: input.pages, origin: 'screenshot' as const, pageCount: input.pages.length }
            : {}),
          // RF-47: .txt lido no device/navegador; o conteúdo segue como texto e o nome vira o título da fonte
          ...(input.textFile && !input.pages
            ? { inputText: input.textFile.content, origin: 'text_file' as const, sourceTitle: input.textFile.name }
            : {}),
        })
        .onConflictDoNothing({ target: [shares.userId, shares.clientShareId] })
        .returning();
      if (inserted[0]) return { row: inserted[0], created: true };
      const [existing] = await tx
        .select()
        .from(shares)
        .where(and(eq(shares.userId, userId), eq(shares.clientShareId, input.clientShareId)));
      return { row: existing!, created: false };
    });

    if (created) {
      // jobId = shareId: enfileirar de novo o mesmo share é no-op
      await this.queue.add('process', { shareId: row.id, userId }, { jobId: row.id });
    }
    const share = await this.get(userId, row.id);
    return { share, created };
  }

  async get(userId: string, id: string): Promise<Share> {
    const share = await withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select().from(shares).where(eq(shares.id, id));
      if (!row) return null;
      const recs = await this.recsFor(tx, [row.id]);
      return toShare(row, recs);
    });
    if (!share) throw new NotFoundException('Compartilhamento não encontrado');
    return share;
  }

  /** RF-19: etapas do pipeline e decisão por candidato, em ordem. */
  async steps(userId: string, id: string): Promise<ShareStepsResponse> {
    const res = await withUser(this.db, userId, async (tx) => {
      const [row] = await tx.select({ id: shares.id, isFixture: shares.isFixture }).from(shares).where(eq(shares.id, id));
      if (!row) return null;
      const steps = await tx.select().from(pipelineStepLogs).where(eq(pipelineStepLogs.shareId, id)).orderBy(asc(pipelineStepLogs.seq));
      const decisions = await tx
        .select()
        .from(candidateDecisions)
        .where(eq(candidateDecisions.shareId, id))
        .orderBy(desc(candidateDecisions.confidenceScore), asc(candidateDecisions.rawTitle));
      return { shareId: row.id, isFixture: row.isFixture, steps: steps.map(toStep), decisions: decisions.map(toDecision) };
    });
    if (!res) throw new NotFoundException('Compartilhamento não encontrado');
    return res;
  }

  async list(userId: string, cursor: string | undefined): Promise<ShareListResponse> {
    const after = cursor ? decodeCursor(cursor) : null;
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(shares)
        .where(
          after
            ? or(
                lt(shares.createdAt, after.createdAt),
                and(eq(shares.createdAt, after.createdAt), lt(shares.id, after.id)),
              )
            : undefined,
        )
        .orderBy(desc(shares.createdAt), desc(shares.id))
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      const recs = await this.recsFor(
        tx,
        page.map((r) => r.id),
      );
      const last = page[page.length - 1];
      return {
        items: page.map((r) =>
          toShare(
            r,
            recs.filter((x) => x.shareId === r.id),
          ),
        ),
        nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await withUser(this.db, userId, (tx) =>
      tx.delete(shares).where(eq(shares.id, id)).returning({ id: shares.id }),
    );
    if (deleted.length === 0) throw new NotFoundException('Compartilhamento não encontrado');
    await this.queue.remove(id).catch(() => undefined);
  }

  private recsFor(tx: Tx, shareIds: string[]) {
    if (shareIds.length === 0) return Promise.resolve([]);
    return tx
      .select()
      .from(recommendations)
      .where(inArray(recommendations.shareId, shareIds))
      .orderBy(desc(recommendations.confidence), asc(recommendations.createdAt));
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  return { createdAt, id };
}
