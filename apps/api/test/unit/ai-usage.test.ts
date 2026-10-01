// Uso de IA: o cliente embrulhado registra modelo, tokens e custo de cada chamada, no contexto
// (usuário + recurso) de quem chamou. Sem contexto, não registra nada.
import { afterEach, describe, expect, it } from 'vitest';
import { costUsd, priceOf, setAiUsageSink, trackingClient, withAiUsage, type AiUsageRow } from '../../src/ai-usage/usage.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

afterEach(() => setAiUsageSink(null));

function fake(result: unknown | Error): LlmClient {
  return {
    messages: {
      parse: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    },
  } as unknown as LlmClient;
}

describe('uso de IA', () => {
  it('preço por modelo (prefixo) e custo', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20 });
    expect(priceOf('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 });
    expect(priceOf('modelo-desconhecido')).toBeNull();
    expect(costUsd('claude-fable-5-1', 1000, 2000)).toBeCloseTo(0.11);
  });

  it('registra cada chamada no contexto de quem chamou; falha registra com zero tokens; sem contexto não registra', async () => {
    const rows: AiUsageRow[] = [];
    setAiUsageSink(async (r) => rows.push(r));
    const ok = trackingClient(fake({ usage: { input_tokens: 1200, output_tokens: 300 } }));
    await withAiUsage('u1', 'tonight_plan', () => ok.messages.parse({ model: 'claude-haiku-4-5', messages: [] }));
    const broken = trackingClient(fake(new Error('rede')));
    await expect(withAiUsage('u1', 'mood', () => broken.messages.parse({ model: 'claude-haiku-4-5', messages: [] }))).rejects.toThrow('rede');
    await ok.messages.parse({ model: 'claude-haiku-4-5', messages: [] }); // fora de contexto
    await new Promise((r) => setTimeout(r, 0));
    expect(rows).toEqual([
      { userId: 'u1', feature: 'tonight_plan', model: 'claude-haiku-4-5', inputTokens: 1200, outputTokens: 300, costUsd: (1200 * 1 + 300 * 5) / 1e6, ok: true },
      { userId: 'u1', feature: 'mood', model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: 0, ok: false },
    ]);
  });

  it('erro ao gravar o uso nunca derruba a chamada de IA', async () => {
    setAiUsageSink(async () => {
      throw new Error('banco fora');
    });
    const ok = trackingClient(fake({ usage: { input_tokens: 1, output_tokens: 1 } }));
    await expect(withAiUsage('u1', 'describe', () => ok.messages.parse({ model: 'claude-haiku-4-5', messages: [] }))).resolves.toBeTruthy();
  });
});
