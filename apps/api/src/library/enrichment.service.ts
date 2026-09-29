import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Resolution } from '@fruiqo/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DB, type Db, withUser } from '../db/client.js';
import { recommendations, type RecommendationRow } from '../db/schema.js';
import { GatewayError, PipelineGateway } from '../pipeline/gateway.js';
import type { TmdbQuery } from '../pipeline/resolvers/tmdb.js';
import { fetchTitleLinks, type TitleLinks } from '../pipeline/resolvers/wikidata.js';
import { createOpenLibraryCatalog } from './openlibrary-catalog.js';
import { createTmdbCatalog } from './tmdb-catalog.js';
import { enrichmentUpdate } from './tmdb-enrichment.js';

export const TITLE_LOOKUP = Symbol('TITLE_LOOKUP');

export interface LookupQuery {
  title: string;
  kind: TmdbQuery['kind'] | 'book';
  year?: number;
  /** autor (livros) */
  creator?: string;
}

/** Busca de título num catálogo externo: TMDB (filmes/séries) e Open Library (livros, RF-48). */
export interface TitleLookup {
  lookup(q: LookupQuery): Promise<Resolution | null>;
  /** D-22: links diretos do título nos serviços (Wikidata) */
  titleLinks?(mediaType: 'movie' | 'tv', tmdbId: number): Promise<TitleLinks>;
}

/** Catálogos pelo PipelineGateway do modo configurado; em `mock` usa as gravações sintéticas. */
export function createTitleLookup(
  env: Pick<Env, 'TMDB_API_KEY' | 'PIPELINE_MODE' | 'OPENLIBRARY_CONTACT'>,
  gateway?: PipelineGateway,
): TitleLookup {
  const gw = gateway ?? new PipelineGateway({ mode: env.PIPELINE_MODE });
  const tmdb = createTmdbCatalog(env, gw);
  const books = createOpenLibraryCatalog(env, gw);
  return {
    async lookup(q) {
      if (q.kind === 'book') {
        return books.lookup({ title: q.title, ...(q.creator ? { author: q.creator } : {}), ...(q.year ? { year: q.year } : {}) });
      }
      if (!tmdb) throw new GatewayError('TMDB indisponível (sem chave)');
      return tmdb.lookup({ title: q.title, kind: q.kind, ...(q.year ? { year: q.year } : {}) });
    },
    titleLinks: (mediaType, tmdbId) => fetchTitleLinks(mediaType, tmdbId, gw.fetchImpl),
  };
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

const ENRICHABLE_KINDS = new Set(['movie', 'series', 'book']);

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

  /**
   * D-22: títulos enriquecidos antes dos links diretos ganham os links na primeira abertura. Consulta
   * o Wikidata uma vez só (grava `titleLinks`, mesmo vazio); falha de rede não impede abrir o título.
   */
  async ensureTitleLinks(userId: string, id: string): Promise<void> {
    if (!this.lookup?.titleLinks) return;
    const row = await withUser(this.db, userId, async (tx) => (await tx.select().from(recommendations).where(eq(recommendations.id, id)))[0]);
    const res = row?.resolution;
    if (!res || res.provider !== 'tmdb' || res.titleLinks !== undefined || !res.tmdbId || !res.mediaType || !res.providers?.length) return;
    const titleLinks = await this.lookup.titleLinks(res.mediaType, res.tmdbId);
    await withUser(this.db, userId, (tx) =>
      tx
        .update(recommendations)
        .set({ resolution: { ...res, titleLinks } })
        .where(eq(recommendations.id, id)),
    );
  }

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
        .where(and(inArray(recommendations.enrichment, [...levels]), inArray(recommendations.kind, ['movie', 'series', 'book'])))
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
      res = await this.lookup.lookup({
        title: row.title,
        kind: row.kind as LookupQuery['kind'],
        ...(row.year ? { year: row.year } : {}),
        ...(row.kind === 'book' && row.creator ? { creator: row.creator } : {}),
      });
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
        .set({
          resolution: res,
          resolvedAt: new Date(),
          ...upd,
          // RF-48: livro sem autor ganha o da Open Library (a chave de dedup de livro não usa o autor)
          ...(row.kind === 'book' && !row.creator && res.authors?.[0] ? { creator: res.authors[0] } : {}),
          updatedAt: new Date(),
        })
        .where(eq(recommendations.id, row.id)),
    );
    onEnriched?.(res);
    return 'enriched';
  }
}
