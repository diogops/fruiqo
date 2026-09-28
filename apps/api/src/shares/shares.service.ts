import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateShareRequest, Share, ShareListResponse } from '@fruiqo/contracts';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { recommendations, shares } from '../db/schema.js';
import { SHARE_QUEUE_TOKEN, type ShareJob } from '../queue/queue.js';
import { toShare } from './share-mapper.js';

const PAGE_SIZE = 20;

@Injectable()
export class SharesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SHARE_QUEUE_TOKEN) private readonly queue: Queue<ShareJob>,
  ) {}

  /** Idempotente por (usuário, clientShareId): retries do app devolvem o mesmo share. */
  async create(userId: string, input: CreateShareRequest): Promise<{ share: Share; created: boolean }> {
    const { row, created } = await withUser(this.db, userId, async (tx) => {
      const inserted = await tx
        .insert(shares)
        .values({
          userId,
          clientShareId: input.clientShareId,
          status: 'queued',
          inputText: input.text ?? null,
          inputUrl: input.url ?? null,
          // prints: OCR feito no device; plataforma não é inferida do texto
          ...(input.pages
            ? { inputPages: input.pages, origin: 'screenshot' as const, pageCount: input.pages.length }
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
