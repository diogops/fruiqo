import type { CatalogSyncStatus } from '@fruiqo/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { type Db, type Tx, withUser } from '../db/client.js';
import { catalogSyncState, recommendations } from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';
import { resolutionFromHit, type TmdbHit, type TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { recomputeAutoRatings } from './auto-rating.js';
import { columnsFromResolution } from './tmdb-enrichment.js';

// D-23: sincronização do Catálogo com o TMDB, pedida pelo dono do produto: primeiro os MAIS BEM
// AVALIADOS, depois do MAIS NOVO para o MAIS VELHO. Só o que está disponível no Brasil (assinatura ou
// grátis). Os títulos entram como `catalog` (fora da Minha Área, sem posição na fila e sem sinal de
// gosto) e seguem a purga de 180 dias do TMDB (TOS-REQ-02). Nada disso vai a LLM (ARB-REQ-06).

type Media = 'movie' | 'tv';
const MEDIAS: Media[] = ['movie', 'tv'];

export interface SyncBudget {
  /** páginas (20 títulos) de "mais bem avaliados" no total, por tipo */
  bestPages: Record<Media, number>;
  /** páginas do mais novo para o mais velho, por rodada e tipo */
  olderPages: Record<Media, number>;
  /** páginas de lançamentos recentes revistas a cada rodada */
  headPages: number;
  /** pausa entre chamadas ao TMDB, em ms */
  delayMs: number;
}

export const DEFAULT_SYNC_BUDGET: SyncBudget = {
  bestPages: { movie: 50, tv: 25 },
  olderPages: { movie: 25, tv: 15 },
  headPages: 2,
  delayMs: 250,
};

const BEST_MIN_VOTES: Record<Media, number> = { movie: 1000, tv: 300 };
/** sem votos nenhuns, o "mais novo" traz lixo (vídeos, testes); pouco já basta */
const NEWEST_MIN_VOTES = 5;

export interface SyncReport {
  added: number;
  pages: number;
}

/** "rodando" sem terminar há mais que isto = interrompido (deploy/reinício): pode rodar de novo */
export const SYNC_STALE_MS = 20 * 60 * 1000;

export function syncIsBusy(s: Pick<CatalogSyncStatus, 'status' | 'lastStartedAt'>, now = Date.now()): boolean {
  if (s.status === 'queued') return true;
  if (s.status !== 'running') return false;
  return !s.lastStartedAt || now - Date.parse(s.lastStartedAt) < SYNC_STALE_MS;
}

export class CatalogSync {
  constructor(
    private readonly db: Db,
    private readonly tmdb: TmdbResolver | null,
    private readonly budget: SyncBudget = DEFAULT_SYNC_BUDGET,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    private readonly log: (msg: string, data: object) => void = () => undefined,
  ) {}

  get available(): boolean {
    return this.tmdb != null;
  }

  /** Marca como na fila (o worker roda). */
  async markQueued(userId: string): Promise<void> {
    await withUser(this.db, userId, (tx) =>
      tx
        .insert(catalogSyncState)
        .values({ userId, status: 'queued' })
        .onConflictDoUpdate({ target: catalogSyncState.userId, set: { status: 'queued', lastError: null } }),
    );
  }

  async status(userId: string): Promise<CatalogSyncStatus> {
    return withUser(this.db, userId, async (tx) => {
      const [s] = await tx.select().from(catalogSyncState).where(eq(catalogSyncState.userId, userId));
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(recommendations)
        .where(and(eq(recommendations.decision, 'cataloged'), eq(recommendations.status, 'catalog')))) as [{ n: number }];
      const older = [s?.olderThanMovie, s?.olderThanTv].filter((d): d is string => Boolean(d)).sort()[0];
      return {
        status: s?.status ?? 'idle',
        available: this.available,
        catalogCount: n,
        lastAdded: s?.lastAdded ?? 0,
        totalAdded: s?.totalAdded ?? 0,
        bestDone: (s?.bestPageMovie ?? 0) >= this.budget.bestPages.movie && (s?.bestPageTv ?? 0) >= this.budget.bestPages.tv,
        ...(older ? { olderThan: older } : {}),
        ...(s?.lastStartedAt ? { lastStartedAt: s.lastStartedAt.toISOString() } : {}),
        ...(s?.lastFinishedAt ? { lastFinishedAt: s.lastFinishedAt.toISOString() } : {}),
        ...(s?.lastError ? { lastError: s.lastError } : {}),
      };
    });
  }

  /** Uma rodada: melhores (até completar), lançamentos recentes e mais uma faixa para trás no tempo. */
  async syncUser(userId: string): Promise<SyncReport> {
    const tmdb = this.tmdb;
    if (!tmdb) throw new Error('TMDB indisponível (sem chave)');
    const state = await withUser(this.db, userId, async (tx) => {
      const [row] = await tx
        .insert(catalogSyncState)
        .values({ userId, status: 'running', lastStartedAt: new Date() })
        .onConflictDoUpdate({ target: catalogSyncState.userId, set: { status: 'running', lastStartedAt: new Date(), lastError: null } })
        .returning();
      return row!;
    });
    const report: SyncReport = { added: 0, pages: 0 };
    const fetchPage = async (media: Media, o: Parameters<TmdbResolver['discoverBrowse']>[1]) => {
      if (report.pages > 0 && this.budget.delayMs > 0) await new Promise((r) => setTimeout(r, this.budget.delayMs));
      report.pages++;
      return tmdb.discoverBrowse(media, o);
    };
    try {
      // 1) os mais bem avaliados, até completar (continua de onde parou)
      const bestPage: Record<Media, number> = { movie: state.bestPageMovie, tv: state.bestPageTv };
      for (const media of MEDIAS) {
        while (bestPage[media] < this.budget.bestPages[media]) {
          const page = bestPage[media] + 1;
          const hits = await fetchPage(media, { sort: 'best', page, availableBR: true, minVotes: BEST_MIN_VOTES[media] });
          report.added += await this.insert(userId, hits);
          bestPage[media] = hits.length < 20 ? this.budget.bestPages[media] : page;
          // progresso a cada página: se o worker reiniciar, continua daqui
          await this.save(userId, { bestPageMovie: bestPage.movie, bestPageTv: bestPage.tv, lastAdded: report.added });
        }
        this.log('sincronização: melhores concluídos', { media, added: report.added, pages: report.pages });
      }

      // 2) do mais novo para o mais velho: lançamentos recentes, depois continua para trás
      const today = this.today();
      const olderThan: Record<Media, string | null> = { movie: state.olderThanMovie, tv: state.olderThanTv };
      for (const media of MEDIAS) {
        for (let page = 1; page <= this.budget.headPages; page++) {
          const hits = await fetchPage(media, { sort: 'newest', page, toDate: today, availableBR: true, minVotes: NEWEST_MIN_VOTES });
          report.added += await this.insert(userId, hits);
          if (hits.length < 20) break;
        }
        const from = olderThan[media] ?? today;
        let oldest = from;
        for (let page = 1; page <= this.budget.olderPages[media]; page++) {
          const hits = await fetchPage(media, { sort: 'newest', page, toDate: from, availableBR: true, minVotes: NEWEST_MIN_VOTES });
          report.added += await this.insert(userId, hits);
          for (const h of hits) if (h.releaseDate && h.releaseDate < oldest) oldest = h.releaseDate;
          if (hits.length < 20) break;
        }
        // mesma data de corte de novo (muitos títulos num dia só): anda um dia para não repetir
        olderThan[media] = oldest < from ? oldest : dayBefore(from);
        await this.save(userId, { olderThanMovie: olderThan.movie, olderThanTv: olderThan.tv, lastAdded: report.added });
        this.log('sincronização: mais novos concluídos', { media, olderThan: olderThan[media], added: report.added, pages: report.pages });
      }
      await withUser(this.db, userId, async (tx) => {
        if (report.added > 0) await recomputeAutoRatings(tx);
        await tx
          .update(catalogSyncState)
          .set({
            status: 'idle',
            olderThanMovie: olderThan.movie,
            olderThanTv: olderThan.tv,
            lastFinishedAt: new Date(),
            lastAdded: report.added,
            totalAdded: sql`${catalogSyncState.totalAdded} + ${report.added}`,
          })
          .where(eq(catalogSyncState.userId, userId));
      });
      return report;
    } catch (err) {
      await this.save(userId, { status: 'failed', lastFinishedAt: new Date(), lastAdded: report.added, lastError: 'TMDB indisponível agora; tente de novo mais tarde' });
      throw err;
    }
  }

  private save(userId: string, set: Partial<typeof catalogSyncState.$inferInsert>) {
    return withUser(this.db, userId, (tx) => tx.update(catalogSyncState).set(set).where(eq(catalogSyncState.userId, userId)));
  }

  /** Grava os que faltam (mesma chave de duplicidade dos imports); devolve quantos entraram. */
  private insert(userId: string, hits: TmdbHit[]): Promise<number> {
    if (hits.length === 0) return Promise.resolve(0);
    const now = new Date();
    const values = hits.map((hit) => {
      const kind = hit.mediaType === 'tv' ? ('series' as const) : ('movie' as const);
      const res = resolutionFromHit(hit);
      const cols = columnsFromResolution(res);
      return {
        userId,
        shareId: null,
        kind,
        title: hit.title,
        year: hit.year ?? null,
        confidence: 1,
        extractor: 'heuristic' as const,
        resolution: res,
        resolvedAt: now,
        genres: cols?.genres ?? [],
        runtimeMin: null,
        enrichment: 'tmdb' as const,
        dedupKey: dedupKey({ kind, title: hit.title, creator: null }),
        decision: 'cataloged' as const,
        status: 'catalog' as const,
        suggestedDecision: 'cataloged' as const,
        decisionReason: 'd23_sync',
        matchScore: 1,
      };
    });
    // chaves repetidas na mesma página (dois títulos com o mesmo nome) quebrariam o INSERT único
    const unique = [...new Map(values.map((v) => [v.dedupKey, v])).values()];
    return withUser(this.db, userId, async (tx: Tx) => {
      const rows = await tx
        .insert(recommendations)
        .values(unique)
        .onConflictDoNothing({ target: [recommendations.userId, recommendations.dedupKey] })
        .returning({ id: recommendations.id });
      return rows.length;
    });
  }
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
