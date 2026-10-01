// D-26: o adaptador da OpenAI fala Chat Completions e devolve a forma do `messages.parse` da Anthropic.
// Sem rede: o fetch é falso.
import { describe, expect, it } from 'vitest';
import { openAiLlmClient } from '../../src/library/openai-llm.js';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const bodies: Array<Record<string, unknown>> = [];
  const fn = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const params = {
  model: 'gpt-6.1-sol',
  max_tokens: 900,
  system: 'regras',
  messages: [{ role: 'user', content: '<request>x</request>' }],
  output_config: { format: { type: 'json_schema', schema: { type: 'object' } }, effort: 'low' },
};
const ok = (content: string, finish = 'stop') => ({
  status: 200,
  body: { choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
});

describe('openAiLlmClient', () => {
  it('monta a requisição (store:false, sem tools, schema, esforço) e devolve parsed_output + usage', async () => {
    const { fn, bodies } = fakeFetch([ok('{"p":[{"t":"Zodiac","k":"movie"}]}')]);
    const res = await openAiLlmClient({ apiKey: 'k', fetchImpl: fn }).messages.parse(params);
    expect(bodies[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      store: false,
      max_completion_tokens: 900,
      reasoning_effort: 'low',
      messages: [
        { role: 'developer', content: 'regras' },
        { role: 'user', content: '<request>x</request>' },
      ],
      response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' }, strict: false } },
    });
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(res).toEqual({ stop_reason: 'end_turn', parsed_output: { p: [{ t: 'Zodiac', k: 'movie' }] }, usage: { input_tokens: 120, output_tokens: 30 } });
  });

  it('400 com esforço: tenta de novo sem ele; corte e recusa viram stop_reason; JSON inválido vira null', async () => {
    const { fn, bodies } = fakeFetch([{ status: 400, body: {} }, ok('{}'), ok('{"p":', 'length'), ok('', 'content_filter'), ok('não é json')]);
    const c = openAiLlmClient({ apiKey: 'k', fetchImpl: fn });
    await c.messages.parse(params);
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect(await c.messages.parse(params)).toMatchObject({ stop_reason: 'max_tokens' });
    expect(await c.messages.parse(params)).toMatchObject({ stop_reason: 'refusal' });
    expect(await c.messages.parse(params)).toMatchObject({ stop_reason: 'end_turn', parsed_output: null });
  });

  it('erro HTTP sem o corpo na mensagem (pode ter texto do usuário)', async () => {
    const { fn } = fakeFetch([{ status: 429, body: { error: { message: 'texto do usuário' } } }]);
    await expect(openAiLlmClient({ apiKey: 'k', fetchImpl: fn }).messages.parse(params)).rejects.toThrow(/^openai: HTTP 429$/);
  });
});
