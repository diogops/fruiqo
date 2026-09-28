import type { CandidateDecisionValue, PipelineMode, Resolution } from '@fruiqo/contracts';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type Db, type Tx, withUser } from '../db/client.js';
import { candidateDecisions, listItems, lists, pipelineStepLogs, recommendations, seenPages, shares, type ShareRow } from '../db/schema.js';
import type { ShareJob } from '../queue/queue.js';
import { dedupKey, mergePages, pageHash } from './dedup.js';
import { listNameFromOcr } from '../library/list-name.js';
import { LlmUnavailableError } from './extractors/anthropic.js';
import { userAllowsAi } from '../library/user-settings.js';
import { GatewayError } from './gateway.js';
import { MAX_LIST_ITEMS } from './extractors/list.js';
import { columnsFromResolution } from '../library/tmdb-enrichment.js';
import type { ExtractedItem, ExtractionInput, Extractor } from './extractors/types.js';
import { normalizeSource } from './normalize.js';
import type { SourceMetadata } from './oembed.js';
import { preview, type Pricing, shortError, StepRecorder } from './steps.js';
import { isUiNoise } from './ui-noise.js';

export interface Resolver {
  supports(item: ExtractedItem): boolean;
  resolve(item: ExtractedItem): Promise<Resolution | null>;
}

export interface DecisionPolicy {
  /** abaixo disto: fila de revisão (RF-28) */
  reviewThreshold: number;
  /** abaixo disto: descartado */
  discardThreshold: number;
}

export const DEFAULT_DECISION_POLICY: DecisionPolicy = { reviewThreshold: 0.5, discardThreshold: 0.15 };

export interface ShareProcessorDeps {
  db: Db;
  logger: Logger;
  heuristic: Extractor;
  /** presente só quando LLM_ENABLED && LLM_REAL_CONTENT_ALLOWED (D-04) */
  llm?: Extractor;
  fetchMetadata: (platform: ReturnType<typeof normalizeSource>['platform'], url: string) => Promise<SourceMetadata | null>;
  resolvers: Resolver[];
  /** modo do PipelineGateway (só informativo aqui: vai para os logs de etapa) */
  mode?: PipelineMode;
  decisionPolicy?: DecisionPolicy;
  pricing?: Pricing;
  /** associa chamadas externas do processamento a uma fixture (modo record) */
  runWithFixture?: <T>(fixtureId: string | null, fn: () => Promise<T>) => Promise<T>;
}

const RESOLVE_CONCURRENCY = 4;
/** abaixo disto nem tenta resolver (não gasta chamada externa) */
const MIN_CONFIDENCE_TO_RESOLVE = 0.3;

type Source = ReturnType<typeof normalizeSource>;
type Keyed = { item: ExtractedItem; key: string };

interface Candidate {
  item: ExtractedItem;
  key: string;
  resolution: Resolution | null;
  alreadyInList: boolean;
  decision: CandidateDecisionValue;
  reason: string;
}

interface FinishResult {
  status: 'done' | 'failed' | 'rejected';
  error?: string;
  source?: Source;
  metadata?: SourceMetadata | null;
  extractor?: 'llm' | 'heuristic';
  candidates?: Candidate[];
  pagesIgnored?: number;
  /** shares de prints: nome da lista gerada automaticamente com os itens catalogados (RF-26) */
  listName?: string;
}

/**
 * Decisão por candidato (RF-19/RF-28). "Sem correspondência" só conta quando existe resolver para o
 * tipo: sem chave de TMDB/Spotify, a decisão fica só pela confiança.
 */
export function decideCandidate(
  item: ExtractedItem,
  resolution: Resolution | null,
  resolverAvailable: boolean,
  policy: DecisionPolicy,
): { decision: CandidateDecisionValue; reason: string } {
  if (item.confidence < policy.discardThreshold) return { decision: 'discarded', reason: 'confidence_below_discard' };
  if (item.confidence < policy.reviewThreshold) return { decision: 'review_queue', reason: 'confidence_below_review' };
  if (resolverAvailable && !resolution) return { decision: 'review_queue', reason: 'no_catalog_match' };
  return { decision: 'cataloged', reason: resolution ? 'resolved' : 'confident' };
}

/**
 * Pipeline de um share, na ordem da ARB-REQ-02: conteúdo → extração → resolução → decisão.
 * Nada que venha de TMDB/Spotify volta para o extrator.
 *
 * Prints (origin = screenshot): o texto de cada print chega do device (OCR local, TOS-REQ-21).
 * Deduplicação em três níveis: print idêntico a um já enviado (seen_pages), linhas repetidas pela
 * sobreposição de rolagem (mergePages) e item já existente na lista do usuário (dedup_key único).
 * Cada etapa é registrada em pipeline_step_logs (RF-19).
 */
export class ShareProcessor {
  private readonly policy: DecisionPolicy;

  constructor(private readonly deps: ShareProcessorDeps) {
    this.policy = deps.decisionPolicy ?? DEFAULT_DECISION_POLICY;
  }

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

    const rec = new StepRecorder(this.deps.mode ?? 'live', share.isFixture, this.deps.pricing);
    const run = () => (share.origin === 'screenshot' ? this.processScreenshots(job, share, rec, log) : this.processLink(job, share, rec, log));
    try {
      await (this.deps.runWithFixture ? this.deps.runWithFixture(share.fixtureId, run) : run());
    } catch (err) {
      // grava o que já foi medido (a etapa que falhou tem o erro) e deixa o BullMQ tentar de novo
      await this.saveSteps(job, rec).catch((e: unknown) => log.warn({ err: shortError(e) }, 'falha ao gravar etapas'));
      throw err;
    }
  }

  private async processLink(job: ShareJob, share: ShareRow, rec: StepRecorder, log: Logger) {
    const text = share.inputText ?? undefined;
    const source = await rec.run(
      'normalize',
      { hasUrl: Boolean(share.inputUrl), textChars: text?.length ?? 0 },
      () => normalizeSource({ url: share.inputUrl, text: share.inputText }),
      (s) => ({ platform: s.platform, url: s.url }),
    );

    if (!source.url && !text?.trim()) {
      await this.finish(job, rec, { status: 'rejected', error: 'Nada para processar neste compartilhamento' });
      return;
    }

    let metadata: SourceMetadata | null = null;
    if (source.url && source.platform !== 'other') {
      try {
        metadata = await rec.run(
          'metadata',
          { platform: source.platform, via: 'oembed' },
          () => this.deps.fetchMetadata(source.platform, source.url!),
          (m) => ({ found: Boolean(m), hasAuthor: Boolean(m?.author), preview: preview(m?.title) }),
        );
      } catch (err) {
        log.warn({ err: shortError(err), platform: source.platform }, 'oEmbed indisponível');
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
      rec,
      log,
    );

    if (items.length === 0 && source.platform === 'other' && !text?.replace(/https:\/\/\S+/g, '').trim()) {
      await this.finish(job, rec, {
        status: 'rejected',
        error: 'Link de plataforma ainda não suportada',
        source,
        metadata,
      });
      return;
    }

    const candidates = await this.resolveAndDecide(job, items, rec, log);
    await this.finish(job, rec, { status: 'done', source, metadata, extractor, candidates });
  }

  private async processScreenshots(job: ShareJob, share: ShareRow, rec: StepRecorder, log: Logger) {
    const pages = share.inputPages ?? [];
    const source: Source = { platform: 'other', url: null };
    rec.note(
      'ocr_input',
      { pages: pages.length },
      { chars: pages.map((p) => p.length), preview: preview(pages[0]) },
    );
    if (pages.length === 0) {
      await this.finish(job, rec, { status: 'rejected', error: 'Nada para processar neste compartilhamento', source });
      return;
    }

    const { fresh, pagesIgnored } = await rec.run(
      'merge_pages',
      { pages: pages.length },
      () => this.registerPages(job, pages),
      (r) => ({ freshPages: r.fresh.length, pagesIgnored: r.pagesIgnored }),
    );
    if (fresh.length === 0) {
      await this.finish(job, rec, { status: 'done', source, candidates: [], pagesIgnored });
      return;
    }

    const merged = mergePages(fresh);
    const lines = merged.split('\n').filter((l) => l.trim());
    const noisy = lines.filter((l) => isUiNoise(l));
    // observação: o filtro de ruído em si roda dentro do extrator de listas; aqui só medimos
    rec.note(
      'noise_filter',
      { linesBeforeMerge: fresh.reduce((n, p) => n + p.split('\n').filter((l) => l.trim()).length, 0), linesAfterMerge: lines.length },
      { noiseLines: noisy.length, keptLines: lines.length - noisy.length, previews: noisy.slice(0, 5).map((l) => preview(l)) },
    );

    const { items, extractor } = await this.extract(
      { userId: job.userId, platform: 'other', origin: 'screenshot', text: merged },
      rec,
      log,
    );
    const candidates = await this.resolveAndDecide(job, items, rec, log);
    const listName = listNameFromOcr(merged, items.map((i) => i.title), new Date());
    await this.finish(job, rec, { status: 'done', source, extractor, candidates, pagesIgnored, listName });
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

  private async extract(
    input: ExtractionInput,
    rec: StepRecorder,
    log: Logger,
  ): Promise<{ items: ExtractedItem[]; extractor: 'llm' | 'heuristic' }> {
    let usage = { inputTokens: 0, outputTokens: 0 };
    let llmNote: string | undefined;
    return rec.run(
      'extract',
      { origin: input.origin, platform: input.platform, textChars: input.text?.length ?? 0, hasTitle: Boolean(input.title), llmAvailable: Boolean(this.deps.llm) },
      async () => {
        let items: ExtractedItem[] | null = null;
        let extractor: 'llm' | 'heuristic' = 'heuristic';
        // SEC-CTRL-51 (D-08): além das flags de ambiente, o LLM só roda com consentimento do usuário
        const llmConsented = this.deps.llm ? await userAllowsAi(this.deps.db, input.userId) : false;
        if (this.deps.llm && !llmConsented) llmNote = 'sem consentimento de IA do usuário';
        if (this.deps.llm && llmConsented) {
          try {
            items = await this.deps.llm.extract({ ...input, onUsage: (u) => (usage = u) });
            extractor = 'llm';
          } catch (err) {
            llmNote = shortError(err);
            if (err instanceof LlmUnavailableError) {
              log.info({ reason: err.message }, 'LLM não usado; usando heurística');
            } else {
              log.warn({ err: llmNote }, 'falha no LLM; usando heurística');
            }
          }
        }
        items ??= await this.deps.heuristic.extract(input);
        return { items: items.slice(0, MAX_LIST_ITEMS), extractor };
      },
      (r) => ({
        extractor: r.extractor,
        count: r.items.length,
        titles: r.items.map((i) => i.title),
        ...(llmNote ? { llmFallback: llmNote } : {}),
      }),
      () => usage,
    );
  }

  /**
   * Dedup dentro do share (fica a ocorrência de maior confiança), resolução só para os itens que o
   * usuário ainda não tem em outro share e decisão por candidato.
   */
  private async resolveAndDecide(job: ShareJob, items: ExtractedItem[], rec: StepRecorder, log: Logger): Promise<Candidate[]> {
    const { unique, existing } = await rec.run(
      'dedup',
      { count: items.length },
      async () => {
        const byKey = new Map<string, Keyed>();
        for (const item of items) {
          const key = dedupKey(item);
          const prev = byKey.get(key);
          if (!prev || item.confidence > prev.item.confidence) byKey.set(key, { item, key });
        }
        const unique = [...byKey.values()];
        const existing =
          unique.length === 0
            ? new Set<string>()
            : await withUser(this.deps.db, job.userId, async (tx) => {
                const rows = await tx
                  .select({ key: recommendations.dedupKey })
                  .from(recommendations)
                  .where(
                    and(
                      inArray(
                        recommendations.dedupKey,
                        unique.map((u) => u.key),
                      ),
                      // título do seed/manual tem share_id nulo e também conta como "já na lista"
                      or(isNull(recommendations.shareId), ne(recommendations.shareId, job.shareId)),
                    ),
                  );
                return new Set(rows.map((r) => r.key));
              });
        return { unique, existing };
      },
      (r) => ({ unique: r.unique.length, alreadyInList: r.existing.size, duplicatesInShare: items.length - r.unique.length }),
    );
    if (unique.length === 0) return [];

    const byProvider: Record<string, number> = {};
    let failures = 0;
    const resolved = await rec.run(
      'resolve',
      { candidates: unique.length, resolvers: this.deps.resolvers.length },
      () =>
        mapLimit(unique, RESOLVE_CONCURRENCY, async ({ item, key }) => {
          const resolver = this.deps.resolvers.find((r) => r.supports(item));
          const alreadyInList = existing.has(key);
          if (alreadyInList || !resolver || item.confidence < MIN_CONFIDENCE_TO_RESOLVE) {
            return { item, key, alreadyInList, resolverAvailable: Boolean(resolver), resolution: null };
          }
          try {
            const resolution = await resolver.resolve(item);
            if (resolution) byProvider[resolution.provider] = (byProvider[resolution.provider] ?? 0) + 1;
            return { item, key, alreadyInList, resolverAvailable: true, resolution };
          } catch (err) {
            // mock sem gravação para este item = resolver indisponível (não é "sem correspondência")
            if (err instanceof GatewayError) {
              return { item, key, alreadyInList, resolverAvailable: false, resolution: null };
            }
            failures++;
            log.warn({ err: shortError(err), kind: item.kind }, 'resolução falhou');
            return { item, key, alreadyInList, resolverAvailable: true, resolution: null };
          }
        }),
      (r) => ({ attempted: r.filter((x) => x.resolverAvailable && !x.alreadyInList).length, resolved: r.filter((x) => x.resolution).length, failures, byProvider }),
    );

    return rec.run(
      'decide',
      { candidates: resolved.length, reviewThreshold: this.policy.reviewThreshold, discardThreshold: this.policy.discardThreshold },
      () =>
        resolved.map((r): Candidate => {
          // item que o usuário já tem não é reavaliado contra o catálogo (não foi resolvido de novo)
          const { decision, reason } = decideCandidate(r.item, r.resolution, r.resolverAvailable && !r.alreadyInList, this.policy);
          return { ...r, decision, reason: r.alreadyInList && decision !== 'discarded' ? 'already_in_list' : reason };
        }),
      (c) => ({
        cataloged: c.filter((x) => x.decision === 'cataloged').length,
        review_queue: c.filter((x) => x.decision === 'review_queue').length,
        discarded: c.filter((x) => x.decision === 'discarded').length,
      }),
    );
  }

  /** Chamado pelo worker quando as tentativas acabam. Mensagem curta, sem detalhe interno. */
  async markFailed(job: ShareJob): Promise<void> {
    await this.finish(job, null, { status: 'failed', error: 'Não foi possível processar agora' });
  }

  private async finish(job: ShareJob, rec: StepRecorder | null, result: FinishResult) {
    const now = new Date();
    await withUser(this.deps.db, job.userId, async (tx) => {
      await tx.delete(recommendations).where(eq(recommendations.shareId, job.shareId));
      const { inserted, idByKey } = await this.insertRecommendations(tx, job, result, now);
      const attempted = result.candidates?.filter((c) => c.decision !== 'discarded').length ?? 0;

      if (result.status !== 'done') {
        // share que não chegou ao fim não "gasta" os prints: reenviar o mesmo print deve funcionar
        await tx.delete(seenPages).where(eq(seenPages.firstShareId, job.shareId));
      }

      if (result.status === 'done' && result.listName) {
        await this.createListFromPrints(tx, job, result, result.listName, now);
      }

      if (rec) {
        for (const c of result.candidates ?? []) {
          rec.decide({ rawTitle: c.item.title, kind: c.item.kind, confidenceScore: c.item.confidence, decision: c.decision, reason: c.reason, dedupKey: c.key });
        }
        await this.writeSteps(tx, job, rec, idByKey);
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

  /**
   * RF-26: share de prints com ≥ 2 itens catalogados vira uma lista, na ordem extraída. Inclui itens
   * que o usuário já tinha (a lista representa o post). Retry do job substitui a lista do share.
   */
  private async createListFromPrints(tx: Tx, job: ShareJob, result: FinishResult, name: string, now: Date) {
    await tx.delete(lists).where(eq(lists.sourceShareId, job.shareId));
    const keys = (result.candidates ?? []).filter((c) => c.decision === 'cataloged').map((c) => c.key);
    if (keys.length < 2) return;
    const rows = await tx
      .select({ id: recommendations.id, key: recommendations.dedupKey })
      .from(recommendations)
      .where(and(inArray(recommendations.dedupKey, keys), eq(recommendations.decision, 'cataloged')));
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));
    const ids = [...new Set(keys.map((k) => idByKey.get(k)).filter((id): id is string => Boolean(id)))];
    if (ids.length < 2) return;
    const [list] = await tx
      .insert(lists)
      .values({ userId: job.userId, name, sourceShareId: job.shareId, createdAt: now, updatedAt: now })
      .returning({ id: lists.id });
    await tx.insert(listItems).values(ids.map((recommendationId, position) => ({ listId: list!.id, recommendationId, userId: job.userId, position })));
  }

  /** Grava só as etapas (usado quando o processamento lança e o job vai ser tentado de novo). */
  private async saveSteps(job: ShareJob, rec: StepRecorder) {
    await withUser(this.deps.db, job.userId, (tx) => this.writeSteps(tx, job, rec, new Map()));
  }

  /** Substitui as etapas/decisões do share (retry do job não duplica). */
  private async writeSteps(tx: Tx, job: ShareJob, rec: StepRecorder, idByKey: Map<string, string>) {
    await tx.delete(pipelineStepLogs).where(eq(pipelineStepLogs.shareId, job.shareId));
    await tx.delete(candidateDecisions).where(eq(candidateDecisions.shareId, job.shareId));
    if (rec.steps.length > 0) {
      await tx.insert(pipelineStepLogs).values(rec.steps.map((s) => ({ ...s, userId: job.userId, shareId: job.shareId })));
    }
    if (rec.decisions.length > 0) {
      await tx.insert(candidateDecisions).values(
        rec.decisions.map((d) => ({
          userId: job.userId,
          shareId: job.shareId,
          recommendationId: idByKey.get(d.dedupKey) ?? null,
          rawTitle: d.rawTitle,
          kind: d.kind,
          confidenceScore: d.confidenceScore,
          decision: d.decision,
          reason: d.reason,
        })),
      );
    }
  }

  /**
   * ON CONFLICT (user_id, dedup_key): item que o usuário já tem não é repetido (inclui corrida entre
   * jobs). Descartados não viram recomendação.
   */
  private async insertRecommendations(tx: Tx, job: ShareJob, result: FinishResult, now: Date) {
    const kept = (result.candidates ?? []).filter((c) => c.decision !== 'discarded');
    if (kept.length === 0) return { inserted: 0, idByKey: new Map<string, string>() };
    const rows = await tx
      .insert(recommendations)
      .values(
        kept.map(({ item, key, resolution, decision, reason }) => ({
          shareId: job.shareId,
          userId: job.userId,
          kind: item.kind,
          title: item.title,
          creator: item.creator ?? null,
          confidence: item.confidence,
          extractor: result.extractor ?? 'heuristic',
          resolution,
          resolvedAt: resolution ? now : null,
          // 2d: gêneros/duração vindos do TMDB (TTL de 180 dias pela purga; TOS-REQ-02)
          ...tmdbInsertColumns(resolution, item.year ?? null),
          dedupKey: key,
          decision: decision as 'cataloged' | 'review_queue',
          decisionReason: reason,
        })),
      )
      .onConflictDoNothing({ target: [recommendations.userId, recommendations.dedupKey] })
      .returning({ id: recommendations.id, key: recommendations.dedupKey });
    return { inserted: rows.length, idByKey: new Map(rows.map((r) => [r.key, r.id])) };
  }
}

function tmdbInsertColumns(resolution: Resolution | null, year: number | null) {
  const cols = columnsFromResolution(resolution);
  if (!cols) return { year };
  return {
    year: year ?? cols.year,
    ...(cols.genres.length > 0 ? { genres: cols.genres } : {}),
    runtimeMin: cols.runtimeMin,
    enrichment: 'tmdb' as const,
  };
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
