// D-25: modelo por etapa. Interpretar o pedido vai ao modelo barato (sem esforço de raciocínio, que o
// Haiku 4.5 recusa); melhorar o resumo e sugerir títulos vão ao modelo principal, com o esforço configurado.
import { describe, expect, it } from 'vitest';
import { AnthropicTasteAi } from '../../src/library/taste-ai.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

function recorder() {
  const calls: Array<{ model: string; output_config: { effort?: string } }> = [];
  const client = {
    messages: {
      parse: async (p: { model: string; output_config: { effort?: string } }) => {
        calls.push(p);
        return { stop_reason: 'end_turn', parsed_output: null };
      },
    },
  } as unknown as LlmClient;
  return { calls, client };
}

describe('modelo por etapa (taste-ai)', () => {
  it('pedido no Haiku sem effort; resumo no modelo principal', async () => {
    const { calls, client } = recorder();
    const ai = new AnthropicTasteAi({ model: 'claude-opus-5-5', planModel: 'claude-haiku-4-5', dailyQuota: 10, effort: 'low', client });
    await ai.planRequest('algo leve pra hoje', 'u1');
    await ai.improveSummary('gosto de suspense', 'u1');
    expect(calls.map((c) => [c.model, c.output_config.effort])).toEqual([
      ['claude-haiku-4-5', undefined],
      ['claude-opus-5-5', 'low'],
    ]);
  });

  it('sem planModel, o pedido usa o modelo principal', async () => {
    const { calls, client } = recorder();
    const ai = new AnthropicTasteAi({ model: 'claude-opus-5-5', dailyQuota: 10, client });
    await ai.planRequest('algo leve', 'u1');
    expect(calls[0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' } });
  });
});
