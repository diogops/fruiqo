import type { MoveTitleRequest } from '@fruiqo/contracts';
import { and, eq, gt, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { recommendations } from '../db/schema.js';

// Fila de prioridade do catálogo: posição única e contínua 1..N por usuário (1 = mais prioritário).
// Inserções e remoções são mantidas por triggers (drizzle/0008_title_rank.sql); aqui ficam as
// reordenações. Todas rodam dentro de withUser (RLS) e sob o mesmo advisory lock por usuário das
// triggers, então operações concorrentes do mesmo usuário são serializadas. A unicidade
// (user_id, rank) é DEFERRABLE: os deslocamentos passam por estados com posições repetidas.

export async function lockQueue(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fruiqo_rank:${userId}`}, 0))`);
}

export async function queueSize(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(and(eq(recommendations.userId, userId), isNotNull(recommendations.rank)));
  return row?.n ?? 0;
}

export type MoveOutcome = { rank: number; total: number } | 'not_found' | 'not_in_queue';

/** Move um título para outra posição, deslocando só o intervalo entre a origem e o destino. */
export async function moveTitle(tx: Tx, userId: string, id: string, req: MoveTitleRequest): Promise<MoveOutcome> {
  await lockQueue(tx, userId);
  const [row] = await tx
    .select({ rank: recommendations.rank })
    .from(recommendations)
    .where(and(eq(recommendations.id, id), eq(recommendations.userId, userId)));
  if (!row) return 'not_found';
  if (row.rank == null) return 'not_in_queue';
  const from = row.rank;
  const total = await queueSize(tx, userId);
  const to = targetPosition(from, total, req);
  if (to !== from) {
    const mine = eq(recommendations.userId, userId);
    if (to < from) {
      await tx
        .update(recommendations)
        .set({ rank: sql`${recommendations.rank} + 1` })
        .where(and(mine, gte(recommendations.rank, to), lt(recommendations.rank, from)));
    } else {
      await tx
        .update(recommendations)
        .set({ rank: sql`${recommendations.rank} - 1` })
        .where(and(mine, gt(recommendations.rank, from), lte(recommendations.rank, to)));
    }
    await tx.update(recommendations).set({ rank: to, updatedAt: new Date() }).where(eq(recommendations.id, id));
  }
  return { rank: to, total };
}

export function targetPosition(from: number, total: number, req: MoveTitleRequest): number {
  if ('position' in req) return Math.min(Math.max(req.position, 1), total);
  switch (req.to) {
    case 'top':
      return 1;
    case 'bottom':
      return total;
    case 'up':
      return Math.max(from - 1, 1);
    case 'down':
      return Math.min(from + 1, total);
  }
}

/**
 * Leva os títulos para o topo (ou fundo) da fila, preservando a ordem relativa entre eles e entre
 * os demais. Itens fora da fila (revisão) são ignorados. Devolve quantos estavam na fila.
 */
export async function moveToEdge(tx: Tx, userId: string, ids: string[], edge: 'top' | 'bottom'): Promise<number> {
  await lockQueue(tx, userId);
  const selected = sql`(${recommendations.id} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${uuidLiteral(i)}'`).join(',')}]::uuid[]`)}))`;
  const direction = edge === 'top' ? sql.raw('DESC') : sql.raw('ASC');
  await tx.execute(sql`
    UPDATE recommendations r SET rank = s.rn
      FROM (
        SELECT id, row_number() OVER (ORDER BY (${selected}) ${direction}, rank, id) AS rn
          FROM recommendations
         WHERE user_id = ${userId} AND rank IS NOT NULL
      ) s
     WHERE r.id = s.id AND r.rank IS DISTINCT FROM s.rn`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recommendations)
    .where(and(eq(recommendations.userId, userId), isNotNull(recommendations.rank), sql`${selected}`));
  return row?.n ?? 0;
}

export type RankSnapshot = { id: string; rank: number }[];

/** Ordem completa da fila, para desfazer uma reordenação em massa. */
export async function snapshotQueue(tx: Tx, userId: string): Promise<RankSnapshot> {
  const rows = await tx
    .select({ id: recommendations.id, rank: recommendations.rank })
    .from(recommendations)
    .where(and(eq(recommendations.userId, userId), isNotNull(recommendations.rank)));
  return rows.map((r) => ({ id: r.id, rank: r.rank! }));
}

/**
 * Restaura uma ordem salva. Só é seguro se a fila ainda tiver exatamente os mesmos títulos; caso
 * contrário devolve false (o chamador responde 409, como no resto do desfazer).
 */
export async function restoreQueue(tx: Tx, userId: string, snapshot: RankSnapshot): Promise<boolean> {
  await lockQueue(tx, userId);
  const current = await snapshotQueue(tx, userId);
  const saved = new Set(snapshot.map((s) => s.id));
  if (current.length !== snapshot.length || current.some((c) => !saved.has(c.id))) return false;
  if (snapshot.length === 0) return true;
  const values = snapshot.map((s) => `('${uuidLiteral(s.id)}'::uuid, ${Number(s.rank)})`).join(',');
  await tx.execute(sql`
    UPDATE recommendations r SET rank = v.rank
      FROM (VALUES ${sql.raw(values)}) AS v(id, rank)
     WHERE r.id = v.id AND r.user_id = ${userId} AND r.rank IS DISTINCT FROM v.rank`);
  return true;
}

// os ids chegam validados como UUID pelo contrato; ainda assim, nada fora do formato entra no SQL
function uuidLiteral(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('id inválido');
  return id.toLowerCase();
}
