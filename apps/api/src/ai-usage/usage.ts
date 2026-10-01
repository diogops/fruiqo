// Uso de IA por chamada: quem chama marca o contexto (usuário + recurso) com `withAiUsage`; o cliente
// embrulhado por `trackingClient` lê o `usage` da resposta e manda para o registro (`setAiUsageSink`,
// ligado ao banco na API e no worker). Nunca registra texto enviado nem resposta. Sem contexto ou sem
// registro configurado (testes, eval), não faz nada.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmClient } from '../pipeline/gateway.js';

export const AI_FEATURES = ['tonight_plan', 'tonight_titles', 'summary_improve', 'mood', 'title_search', 'describe', 'image_titles', 'share_extract'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiUsageRow {
  userId: string;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ok: boolean;
}

/** US$ por 1M tokens (entrada, saída) — preços oficiais; o raciocínio do modelo é cobrado como saída. */
const PRICES: [prefix: string, input: number, output: number][] = [
  ['claude-fable-5', 10, 50],
  ['claude-mythos-5', 10, 50],
  ['claude-opus-5-5', 4, 20],
  ['claude-opus-5', 5, 25],
  ['claude-opus-4', 5, 25],
  ['claude-sonnet-5', 2, 10],
  ['claude-sonnet-4', 3, 15],
  ['claude-haiku-4-5', 1, 5],
  ['gpt-6.1-sol', 2, 10],
  ['gpt-6-astra', 10, 50],
  ['gpt-6-luna', 0.1, 0.5],
];

export function priceOf(model: string): { input: number; output: number } | null {
  const p = PRICES.find(([prefix]) => model.startsWith(prefix));
  return p ? { input: p[1], output: p[2] } : null;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : 0;
}

const context = new AsyncLocalStorage<{ userId: string; feature: AiFeature }>();
let sink: ((row: AiUsageRow) => Promise<unknown>) | null = null;

/** Liga o registro (API e worker). null desliga. */
export function setAiUsageSink(fn: ((row: AiUsageRow) => Promise<unknown>) | null): void {
  sink = fn;
}

/** Marca as chamadas de IA feitas dentro de `fn` como deste usuário e recurso. */
export function withAiUsage<T>(userId: string, feature: AiFeature, fn: () => Promise<T>): Promise<T> {
  return context.run({ userId, feature }, fn);
}

interface UsageLike {
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Embrulha o cliente: cada chamada registra modelo, tokens e custo (falha também, com zero tokens). */
export function trackingClient(client: LlmClient): LlmClient {
  return {
    messages: {
      parse: async (params) => {
        const ctx = context.getStore();
        try {
          const res = (await client.messages.parse(params)) as UsageLike;
          if (ctx) record(ctx, params.model, res?.usage?.input_tokens ?? 0, res?.usage?.output_tokens ?? 0, true);
          return res;
        } catch (err) {
          if (ctx) record(ctx, params.model, 0, 0, false);
          throw err;
        }
      },
    },
  };
}

function record(ctx: { userId: string; feature: AiFeature }, model: string, inputTokens: number, outputTokens: number, ok: boolean): void {
  if (!sink) return;
  // o registro nunca derruba a chamada de IA
  void sink({ ...ctx, model, inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens), ok }).catch(() => undefined);
}
