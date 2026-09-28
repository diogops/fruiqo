import type { Resolution } from '@fruiqo/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type Db, type Tx, withUser } from '../db/client.js';
import { recommendations, seenPages, shares, type ShareRow } from '../db/schema.js';
import type { ShareJob } from '../queue/queue.js';
import { dedupKey, mergePages, pageHash } from './dedup.js';
import { LlmUnavailableError } from './extractors/anthropic.js';
import { MAX_LIST_ITEMS } from './extractors/list.js';
import type { ExtractedItem, ExtractionInput, Extractor } from './extractors/types.js';
import { normalizeSource } from './normalize.js';
import type { SourceMetadata } from './oembed.js';

export interface Resolver {
  supports(item: ExtractedItem): boolean;
  resolve(item: ExtractedItem): Promise<Resolution | null>;
}

export interface ShareProcessorDeps {
  db: Db;
  logger: Logger;
  heuristic: Extractor;
  /** presente só quando LLM_ENABLED && LLM_REAL_CONTENT_ALLOWED (D-04) */
  llm?: Extractor;
  fetchMetadata: (platform: ReturnType<typeof normalizeSource>['platform'], url: string) => Promise<SourceMetadata | null>;
  resolvers: Resolver[];
}

const RESOLVE_CONCURRENCY = 4;

type Source = ReturnType<typeof normalizeSource>;
type Keyed = { item: ExtractedItem; key: string };

interface FinishResult {
  status: 'done' | 'failed' | 'rejected';
  error?: string;
  source?: Source;
  metadata?: SourceMetadata | null;
  extractor?: 'llm' | 'heuristic';
  resolved?: { item: ExtractedItem; key: string; resolution: Resolution | null }[];
  pagesIgnored?: number;
}

/**
 * Pipeline de um share, na ordem da ARB-REQ-02: conteúdo → extração → resolução.
 * Nada que venha de TMDB/Spotify volta para o extrator.
 *
 * Prints (origin = screenshot): o texto de cada print chega do device (OCR local, TOS-REQ-21).
 * Deduplicação em três níveis: print idêntico a um já enviado (seen_pages), linhas repetidas pela
 * sobreposição de rolagem (mergePages) e item já existente na lista do usuário (dedup_key único).
 */
export class ShareProcessor {
  constructor(private readonly deps: ShareProcessorDeps) {}

  async process(job: ShareJob): Promise<void> {
    const { db, logger } = this.deps;
    const log = logger.child({ shareId: job.shareId });

    const share = await withUser(db, job.userId, async (tx) => {
      const [row] = await tx.select().from(shares).where(eq(shares.id, job.shareId)).for('update');
      if (!row || row.status === 'done' || row.status === 'rejected' || row.status === 'failed') {
        return null;
      }
      await tx.update(shares).set({ status: 'processing', updatedAt: new Date() }).where(eq(shares.id, row.id));
      return row;
    });
    if (!share) return; // apagado ou já processado

    if (share.origin === 'screenshot') {
      await this.processScreenshots(job, share, log);
      return;
    }

    const source = normalizeSource({ url: share.inputUrl, text: share.inputText });
    const text = share.inputText ?? undefined;

    if (!source.url && !text?.trim()) {
      await this.finish(job, { status: 'rejected', error: 'Nada para processar neste compartilhamento' });
      return;
    }

    let metadata: SourceMetadata | null = null;
    if (source.url && source.platform !== 'other') {
      try {
        metadata = await this.deps.fetchMetadata(source.platform, source.url);
      } catch (err) {
        log.warn({ err: (err as Error).message, platform: source.platform }, 'oEmbed indisponível');
      }
    }

    const { items, extractor } = await this.extract(
      {
        userId: job.userId,
        platform: source.platform,
        origin: 'link',
        ...(text ? { text } : {}),
        ...(metadata?.title ? { title: metadata.title } : {}),
        ...(metadata?.author ? { author: metadata.author } : {}),
      },
      log,
    );

    if (items.length === 0 && source.platform === 'other' && !text?.replace(/https:\/\/\S+/g, '').trim()) {
      await this.finish(job, {
        status: 'rejected',
        error: 'Link de plataforma ainda não suportada',
        source,
        metadata,
      });
      return;
    }

    const resolved = await this.resolveNew(job, items, log);
    await this.finish(job, { status: 'done', source, metadata, extractor, resolved });
  }

  private async processScreenshots(job: ShareJob, share: ShareRow, log: Logger) {
    const pages = share.inputPages ?? [];
    const source: Source = { platform: 'other', url: null };
    if (pages.length === 0) {
      await this.finish(job, { status: 'rejected', error: 'Nada para processar neste compartilhamento', source });
      return;
    }

    const { fresh, pagesIgnored } = await this.registerPages(job, pages);
    if (fresh.length === 0) {
      await this.finish(job, { status: 'done', source, resolved: [], pagesIgnored });
      return;
    }

    const { items, extractor } = await this.extract(
      { userId: job.userId, platform: 'other', origin: 'screenshot', text: mergePages(fresh) },
      log,
    );
    const resolved = await this.resolveNew(job, items, log);
    await this.finish(job, { status: 'done', source, extractor, resolved, pagesIgnored });
  }

  /**
   * Registra os hashes dos prints e devolve só os inéditos para o usuário. Um print já registrado por
   * OUTRO share é ignorado; se o registro é deste mesmo share (retry do job), conta como inédito.
   * ON CONFLICT resolve a corrida entre dois jobs com o mesmo print: só um deles fica com o print.
   */
  private async registerPages(job: ShareJob, pages: string[]) {
    const hashed = pages.map((text) => ({ text, hash: pageHash(text) }));
    const distinct = [...new Set(hashed.map((p) => p.hash))];

    const owned = await withUser(this.deps.db, job.userId, async (tx) => {
      await tx
        .insert(seenPages)
        .values(distinct.map((pageHash) => ({ userId: job.userId, pageHash, firstShareId: job.shareId })))
        .onConflictDoNothing({ target: [seenPages.userId, seenPages.pageHash] });
      const rows = await tx
        .select({ pageHash: seenPages.pageHash, firstShareId: seenPages.firstShareId })
        .from(seenPages)
        .where(inArray(seenPages.pageHash, distinct));
      return new Set(rows.filter((r) => r.firstShareId === job.shareId).map((r) => r.pageHash));
    });

    return {
      fresh: hashed.filter((p) => owned.has(p.hash)).map((p) => p.text),
      pagesIgnored: distinct.filter((h) => !owned.has(h)).length,
    };
  }

  private async extract(input: ExtractionInput, log: Logger): Promise<{ items: ExtractedItem[]; extractor: 'llm' | 'heuristic' }> {
    let items: ExtractedItem[] | null = null;
    let extractor: 'llm' | 'heuristic' = 'heuristic';
    if (this.deps.llm) {
      try {
        items = await this.deps.llm.extract(input);
        extractor = 'llm';
      } catch (err) {
        if (err instanceof LlmUnavailableError) {
          log.info({ reason: err.message }, 'LLM não usado; usando heurística');
        } else {
          log.warn({ err: (err as Error).message }, 'falha no LLM; usando heurística');
        }
      }
    }
    items ??= await this.deps.heuristic.extract(input);
    return { items: items.slice(0, MAX_LIST_ITEMS), extractor };
  }

  /**
   * Dedup dentro do share (fica a ocorrência de maior confiança) e resolução só para os itens que o
   * usuário ainda não tem em outro share, para não gastar chamada em TMDB/Spotify à toa.
   */
  private async resolveNew(job: ShareJob, items: ExtractedItem[], log: Logger) {
    const byKey = new Map<string, Keyed>();
    for (const item of items) {
      const key = dedupKey(item);
      const prev = byKey.get(key);
      if (!prev || item.confidence > prev.item.confidence) byKey.set(key, { item, key });
    }
    const unique = [...byKey.values()];
    if (unique.length === 0) return [];

    const existing = await withUser(this.deps.db, job.userId, async (tx) => {
      const rows = await tx
        .select({ key: recommendations.dedupKey })
        .from(recommendations)
        .where(
          and(
            inArray(
              recommendations.dedupKey,
              unique.map((u) => u.key),
            ),
            ne(recommendations.shareId, job.shareId),
          ),
        );
      return new Set(rows.map((r) => r.key));
    });

    return mapLimit(unique, RESOLVE_CONCURRENCY, async ({ item, key }) => {
      const resolver = this.deps.resolvers.find((r) => r.supports(item));
      if (existing.has(key) || !resolver || item.confidence < 0.3) return { item, key, resolution: null };
      try {
        return { item, key, resolution: await resolver.resolve(item) };
      } catch (err) {
        log.warn({ err: (err as Error).message, kind: item.kind }, 'resolução falhou');
        return { item, key, resolution: null };
      }
    });
  }

  /** Chamado pelo worker quando as tentativas acabam. Mensagem curta, sem detalhe interno. */
  async markFailed(job: ShareJob): Promise<void> {
    await this.finish(job, { status: 'failed', error: 'Não foi possível processar agora' });
  }

  private async finish(job: ShareJob, result: FinishResult) {
    const now = new Date();
    await withUser(this.deps.db, job.userId, async (tx) => {
      await tx.delete(recommendations).where(eq(recommendations.shareId, job.shareId));
      const inserted = await this.insertRecommendations(tx, job, result, now);
      const attempted = result.resolved?.length ?? 0;

      if (result.status !== 'done') {
        // share que não chegou ao fim não "gasta" os prints: reenviar o mesmo print deve funcionar
        await tx.delete(seenPages).where(eq(seenPages.firstShareId, job.shareId));
      }

      await tx
        .update(shares)
        .set({
          status: result.status,
          error: result.error ?? null,
          ...(result.source ? { platform: result.source.platform, sourceUrl: result.source.url } : {}),
          sourceTitle: result.metadata?.title ?? null,
          sourceAuthor: result.metadata?.author ?? null,
          sourceThumbnailUrl: result.metadata?.thumbnailUrl ?? null,
          sourceFetchedAt: result.metadata ? now : null,
          // minimização: texto bruto e texto dos prints não são mais necessários depois do processamento
          inputText: result.status === 'failed' ? undefined : null,
          inputPages: result.status === 'failed' ? undefined : null,
          pagesIgnored: result.pagesIgnored ?? 0,
          itemsAlreadyInList: attempted - inserted,
          updatedAt: now,
        })
        .where(eq(shares.id, job.shareId));
    });
  }

  /** ON CONFLICT (user_id, dedup_key): item que o usuário já tem não é repetido (inclui corrida entre jobs). */
  private async insertRecommendations(tx: Tx, job: ShareJob, result: FinishResult, now: Date): Promise<number> {
    if (!result.resolved || result.resolved.length === 0) return 0;
    const rows = await tx
      .insert(recommendations)
      .values(
        result.resolved.map(({ item, key, resolution }) => ({
          shareId: job.shareId,
          userId: job.userId,
          kind: item.kind,
          title: item.title,
          creator: item.creator ?? null,
          year: item.year ?? null,
          confidence: item.confidence,
          extractor: result.extractor ?? 'heuristic',
          resolution,
          resolvedAt: resolution ? now : null,
          dedupKey: key,
        })),
      )
      .onConflictDoNothing({ target: [recommendations.userId, recommendations.dedupKey] })
      .returning({ id: recommendations.id });
    return rows.length;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
