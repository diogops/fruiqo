// D-25: modelo por etapa. Interpretar o pedido vai ao modelo barato (sem esforço de raciocínio, que o
// Haiku 4.5 recusa); melhorar o resumo e sugerir títulos vão ao modelo principal, com o esforço configurado.
import { describe, expect, it } from 'vitest';
import { AnthropicTasteAi, type TasteBrief } from '../../src/library/taste-ai.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

const BRIEF: TasteBrief = {
  mood: 'algo leve',
  summary: null,
  loves: [],
  likes: [],
  dislikes: [],
  hates: [],
  likedSubgenres: [],
  dislikedSubgenres: [],
  favorites: [],
  loved: [],
  disliked: [],
  queue: [],
  avoid: [],
};

function recorder(output: unknown = null) {
  const calls: Array<{ model: string; output_config: { effort?: string } }> = [];
  const client = {
    messages: {
      parse: async (p: { model: string; output_config: { effort?: string } }) => {
        calls.push(p);
        return { stop_reason: 'end_turn', parsed_output: output };
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

  it('D-26: com outro provedor, só o gerador de títulos vai para ele', async () => {
    const main = recorder();
    const other = recorder();
    const ai = new AnthropicTasteAi({
      model: 'claude-opus-5-5',
      planModel: 'claude-haiku-4-5',
      dailyQuota: 10,
      effort: 'low',
      client: main.client,
      titles: { model: 'gpt-6.1-sol', client: other.client },
    });
    await ai.planRequest('algo leve', 'u1');
    await ai.tonight(BRIEF, 'u1', 'movie');
    // a resposta falsa não tem o formato: cai para o modelo principal da Anthropic (Opus), não para o Haiku
    expect(other.calls.map((c) => [c.model, c.output_config.effort])).toEqual([['gpt-6.1-sol', 'low']]);
    expect(main.calls.map((c) => c.model)).toEqual(['claude-haiku-4-5', 'claude-opus-5-5']);
  });

  it('D-26: OpenAI fora do ar → Opus responde e os títulos chegam', async () => {
    const main = recorder({ p: [{ t: 'Zodíaco', k: 'movie', y: 2007 }] });
    const down = {
      messages: {
        parse: async () => {
          throw new Error('openai: HTTP 503');
        },
      },
    } as unknown as LlmClient;
    const ai = new AnthropicTasteAi({ model: 'claude-opus-5-5', dailyQuota: 10, client: main.client, titles: { model: 'gpt-6.1-sol', client: down } });
    const res = await ai.tonight(BRIEF, 'u1', 'movie');
    expect(res).toMatchObject({ ok: true, value: { picks: [{ title: 'Zodíaco', kind: 'movie', year: 2007 }] } });
    expect(main.calls.map((c) => c.model)).toEqual(['claude-opus-5-5']);
  });
});
