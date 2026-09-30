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
import { recomputeAutoRatings } from './auto-rating.js';
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
  /** D-23: dados atuais de um título já identificado (atualização agendada), sem consultar o Wikidata */
  refreshTmdb?(mediaType: 'movie' | 'tv', tmdbId: number): Promise<Resolution | null>;
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
    async refreshTmdb(mediaType, tmdbId) {
      if (!tmdb) throw new GatewayError('TMDB indisponível (sem chave)');
      return tmdb.byId(mediaType, tmdbId, undefined, { titleLinks: false });
    },
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

export interface RefreshReport {
  refreshed: number;
  enriched: number;
  errors: number;
}

/** D-23: títulos do Catálogo (fora da Minha Área) só são atualizados com dado mais velho que isto */
const REFRESH_STALE_MS = 30 * 24 * 3600 * 1000;
const REFRESH_CATALOG_CAP = 400;

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
    let row = await withUser(this.db, userId, async (tx) => (await tx.select().from(recommendations).where(eq(recommendations.id, id)))[0]);
    // D-23: título sincronizado ainda sem detalhes (onde assistir, duração): busca na primeira abertura
    const synced = row?.resolution;
    if (row && synced?.provider === 'tmdb' && synced.tmdbId && synced.mediaType && synced.providers === undefined && this.lookup.refreshTmdb) {
      const detail = await this.lookup.refreshTmdb(synced.mediaType, synced.tmdbId);
      if (detail) {
        // lista vazia também é gravada: marca que os detalhes já foram buscados
        const next: Resolution = { ...synced, ...detail, providers: detail.providers ?? [] };
        const current = row;
        row = await withUser(this.db, userId, async (tx) =>
          (
            await tx
              .update(recommendations)
              .set({ resolution: next, resolvedAt: new Date(), ...enrichmentUpdate(current, next), updatedAt: new Date() })
              .where(eq(recommendations.id, id))
              .returning()
          )[0],
        );
      }
    }
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

  /**
   * D-23: atualização agendada (12h e 21h). Filmes/séries já identificados no TMDB ganham os dados
   * atuais (nota geral, onde assistir via JustWatch/TMDB, duração); os ainda sem enriquecimento são
   * buscados pelo título. Depois recalcula a nota automática. Nada disso vai a LLM (ARB-REQ-06).
   */
  async refreshUser(userId: string, opts: { delayMs?: number } = {}): Promise<RefreshReport> {
    const report: RefreshReport = { refreshed: 0, enriched: 0, errors: 0 };
    if (!this.lookup?.refreshTmdb) return report;
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.decision, 'cataloged'), inArray(recommendations.kind, ['movie', 'series'])))
        .orderBy(recommendations.createdAt),
    );
    const delay = opts.delayMs ?? 250;
    // Minha Área (para ver) sempre; o resto do Catálogo só com dado velho, e com teto por rodada
    const staleBefore = Date.now() - REFRESH_STALE_MS;
    const todo = [
      ...rows.filter((r) => r.status === 'to_watch' || r.status === 'watching'),
      ...rows
        .filter((r) => r.status !== 'to_watch' && r.status !== 'watching' && (!r.resolvedAt || r.resolvedAt.getTime() < staleBefore))
        .slice(0, REFRESH_CATALOG_CAP),
    ];
    for (const row of todo) {
      const old = row.resolution;
      try {
        if (old?.provider === 'tmdb' && old.tmdbId && old.mediaType) {
          const res = await this.lookup.refreshTmdb(old.mediaType, old.tmdbId);
          if (res) {
            // mantém os links diretos (D-22) enquanto houver onde assistir; sem eles, a abertura busca de novo
            const next: Resolution = { ...res, ...(res.providers?.length && old.titleLinks !== undefined ? { titleLinks: old.titleLinks } : {}) };
            const upd = enrichmentUpdate(row, next);
            await withUser(this.db, userId, (tx) =>
              tx
                .update(recommendations)
                .set({ resolution: next, resolvedAt: new Date(), ...upd, updatedAt: new Date() })
                .where(eq(recommendations.id, row.id)),
            );
            report.refreshed++;
          }
        } else if (row.enrichment === 'none') {
          if ((await this.enrichRow(userId, row)) === 'enriched') report.enriched++;
        } else continue;
      } catch {
        report.errors++;
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    await withUser(this.db, userId, (tx) => recomputeAutoRatings(tx));
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
