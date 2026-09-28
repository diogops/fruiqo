import type { CandidateDecisionValue, PipelineMode, PipelineStepName, RecommendationKind } from '@fruiqo/contracts';

/** RF-19: trechos de texto de terceiros nos resumos têm no máximo isto. */
export const PREVIEW_MAX = 200;

export function preview(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

export interface StepEntry {
  seq: number;
  step: PipelineStepName;
  mode: PipelineMode;
  startedAt: Date;
  durationMs: number;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  costEstimateUsd: number;
  error: string | null;
}

export interface DecisionEntry {
  rawTitle: string;
  kind: RecommendationKind;
  confidenceScore: number;
  decision: CandidateDecisionValue;
  reason: string;
  dedupKey: string;
}

export interface Pricing {
  inPerMTok: number;
  outPerMTok: number;
}

/**
 * Registra as etapas de um processamento em memória; o processor grava tudo na mesma transação que
 * fecha o share. Campos `preview` (texto de terceiros) só sobrevivem em shares de fixture (RF-19 4).
 */
export class StepRecorder {
  readonly steps: StepEntry[] = [];
  readonly decisions: DecisionEntry[] = [];

  constructor(
    readonly mode: PipelineMode,
    private readonly keepPreviews: boolean,
    private readonly pricing: Pricing = { inPerMTok: 0, outPerMTok: 0 },
  ) {}

  /**
   * Mede a etapa. `summarize` recebe o resultado e devolve o resumo de saída; `usage` (opcional)
   * devolve tokens gastos. Se a etapa lançar, a etapa é registrada com o erro e o erro segue.
   */
  async run<T>(
    step: PipelineStepName,
    input: Record<string, unknown>,
    fn: () => Promise<T> | T,
    summarize: (result: T) => Record<string, unknown>,
    usage?: () => { inputTokens: number; outputTokens: number },
  ): Promise<T> {
    const startedAt = new Date();
    const t0 = performance.now();
    try {
      const result = await fn();
      this.push(step, startedAt, t0, input, summarize(result), usage?.(), null);
      return result;
    } catch (err) {
      this.push(step, startedAt, t0, input, {}, usage?.(), shortError(err));
      throw err;
    }
  }

  /** Etapa que não falha a execução (ex.: oEmbed indisponível): registra o erro e continua. */
  note(step: PipelineStepName, input: Record<string, unknown>, output: Record<string, unknown>, error?: string) {
    this.push(step, new Date(), performance.now(), input, output, undefined, error ?? null);
  }

  decide(entry: DecisionEntry) {
    this.decisions.push(entry);
  }

  get totalCostUsd(): number {
    return this.steps.reduce((sum, s) => sum + s.costEstimateUsd, 0);
  }

  private push(
    step: PipelineStepName,
    startedAt: Date,
    t0: number,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    usage: { inputTokens: number; outputTokens: number } | undefined,
    error: string | null,
  ) {
    const tokensIn = usage?.inputTokens ?? 0;
    const tokensOut = usage?.outputTokens ?? 0;
    this.steps.push({
      seq: this.steps.length,
      step,
      mode: this.mode,
      startedAt,
      durationMs: Math.max(0, Math.round(performance.now() - t0)),
      inputSummary: this.clean(input),
      outputSummary: this.clean(output),
      tokensIn,
      tokensOut,
      costEstimateUsd: (tokensIn * this.pricing.inPerMTok + tokensOut * this.pricing.outPerMTok) / 1_000_000,
      error,
    });
  }

  /** Remove `undefined` e, fora de fixture, qualquer campo `preview`/`previews` (texto de terceiros). */
  private clean(summary: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(summary)) {
      if (v === undefined) continue;
      if (!this.keepPreviews && (k === 'preview' || k === 'previews')) continue;
      out[k] = v;
    }
    return out;
  }
}

/** Mensagem curta, sem stack nem dados (SEC-REQ-14). */
export function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 200);
}
