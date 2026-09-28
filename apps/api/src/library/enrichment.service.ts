import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Resolution } from '@fruiqo/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DB, type Db, withUser } from '../db/client.js';
import { recommendations, type RecommendationRow } from '../db/schema.js';
import { GatewayError, PipelineGateway } from '../pipeline/gateway.js';
import { TmdbResolver, type TmdbQuery } from '../pipeline/resolvers/tmdb.js';
import { enrichmentUpdate } from './tmdb-enrichment.js';

export const TITLE_LOOKUP = Symbol('TITLE_LOOKUP');

/** Busca de título num catálogo externo (hoje só TMDB). null = catálogo indisponível (sem chave). */
export interface TitleLookup {
  lookup(q: TmdbQuery): Promise<Resolution | null>;
}

/** TMDB pelo PipelineGateway do modo configurado; em `mock` usa as gravações sintéticas. */
export function createTitleLookup(env: Pick<Env, 'TMDB_API_KEY' | 'PIPELINE_MODE'>, gateway?: PipelineGateway): TitleLookup | null {
  const key = env.TMDB_API_KEY ?? (env.PIPELINE_MODE === 'mock' ? 'mock-key' : undefined);
  if (!key) return null;
  const gw = gateway ?? new PipelineGateway({ mode: env.PIPELINE_MODE });
  return new TmdbResolver(key, gw.fetchImpl);
}

export type EnrichStatus = 'enriched' | 'no_match' | 'unsupported' | 'unavailable';

export interface BackfillOptions {
  /** reprocessa também títulos do seed (`demo`); padrão: só `none` */
  includeDemo?: boolean;
  limit?: number;
  /** chamadas simultâneas ao TMDB (baixo de propósito: rate limit) */
  concurrency?: number;
  /** pausa entre títulos por "trabalhador", em ms */
  delayMs?: number;
  onResult?: (title: string, status: EnrichStatus, res: Resolution | null) => void;
}

export interface BackfillReport {
  candidates: number;
  enriched: number;
  noMatch: number;
  unavailable: number;
  errors: number;
}

const ENRICHABLE_KINDS = new Set(['movie', 'series']);

/**
 * Enriquecimento TMDB de títulos do catálogo (2d; RF-05/06/38). Gêneros `manual` nunca são
 * sobrescritos. A rede fica fora da transação; a gravação é por título, sob RLS.
 */
@Injectable()
export class EnrichmentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(TITLE_LOOKUP) private readonly lookup: TitleLookup | null,
  ) {}

  get available(): boolean {
    return this.lookup != null;
  }

  async enrichOne(userId: string, id: string): Promise<EnrichStatus> {
    const row = await withUser(this.db, userId, async (tx) => {
      const [r] = await tx.select().from(recommendations).where(eq(recommendations.id, id));
      return r;
    });
    if (!row) throw new NotFoundException('Título não encontrado');
    return this.enrichRow(userId, row);
  }

  async backfill(userId: string, opts: BackfillOptions = {}): Promise<BackfillReport> {
    const levels = opts.includeDemo ? (['none', 'demo'] as const) : (['none'] as const);
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select()
        .from(recommendations)
        .where(and(inArray(recommendations.enrichment, [...levels]), inArray(recommendations.kind, ['movie', 'series'])))
        .orderBy(recommendations.createdAt),
    );
    const todo = opts.limit ? rows.slice(0, opts.limit) : rows;
    const report: BackfillReport = { candidates: todo.length, enriched: 0, noMatch: 0, unavailable: 0, errors: 0 };
    const delay = opts.delayMs ?? 250;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const row = todo[next++]!;
        try {
          const status = await this.enrichRow(userId, row, (res) => opts.onResult?.(row.title, 'enriched', res));
          if (status === 'enriched') report.enriched++;
          else if (status === 'no_match') {
            report.noMatch++;
            opts.onResult?.(row.title, status, null);
          } else {
            report.unavailable++;
            opts.onResult?.(row.title, status, null);
          }
        } catch {
          report.errors++;
          opts.onResult?.(row.title, 'unavailable', null);
        }
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 2, todo.length)) }, worker));
    return report;
  }

  private async enrichRow(userId: string, row: RecommendationRow, onEnriched?: (res: Resolution) => void): Promise<EnrichStatus> {
    if (!ENRICHABLE_KINDS.has(row.kind)) return 'unsupported';
    if (!this.lookup) return 'unavailable';
    let res: Resolution | null;
    try {
      res = await this.lookup.lookup({ title: row.title, kind: row.kind as TmdbQuery['kind'], ...(row.year ? { year: row.year } : {}) });
    } catch (err) {
      // mock sem gravação para este título = catálogo indisponível (não é "sem correspondência")
      if (err instanceof GatewayError) return 'unavailable';
      throw err;
    }
    if (!res) return 'no_match';
    const upd = enrichmentUpdate(row, res);
    await withUser(this.db, userId, (tx) =>
      tx
        .update(recommendations)
        .set({ resolution: res, resolvedAt: new Date(), ...upd, updatedAt: new Date() })
        .where(eq(recommendations.id, row.id)),
    );
    onEnriched?.(res);
    return 'enriched';
  }
}
