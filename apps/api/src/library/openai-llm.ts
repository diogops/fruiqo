// D-26: cliente da API da OpenAI (Chat Completions) com a mesma forma do `messages.parse` da Anthropic
// que o resto do código usa (`LlmClient`). Assim ele passa pelo PipelineGateway (mock/eval) e pelo
// `trackingClient` (uso de IA) sem nada especial. Só o gerador de títulos do "O que assistir hoje?" usa,
// e só com AI_TONIGHT_TITLES_PROVIDER=openai. Sem `tools`; a resposta é JSON, validada por quem chama.
// Erros nunca carregam o corpo da requisição nem da resposta (pode ter texto do usuário).
import type { LlmClient } from '../pipeline/gateway.js';

interface ParseParams {
  model: string;
  system?: unknown;
  messages: unknown;
  max_tokens?: number;
  output_config?: { format?: { schema?: unknown }; effort?: 'low' | 'medium' | 'high' };
}

interface ChatResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function openAiLlmClient(opts: { apiKey: string; timeoutMs?: number; fetchImpl?: typeof fetch }): LlmClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const post = (body: Record<string, unknown>) =>
    doFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });

  return {
    messages: {
      parse: async (raw) => {
        const p = raw as unknown as ParseParams;
        const schema = p.output_config?.format?.schema;
        const body: Record<string, unknown> = {
          model: p.model,
          // docs/phase0/openai-api-tos.md: nada guardado na OpenAI além da retenção obrigatória
          store: false,
          messages: [
            ...(typeof p.system === 'string' ? [{ role: 'developer', content: p.system }] : []),
            ...(p.messages as Array<{ role: string; content: string }>),
          ],
          ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: false } } } : {}),
          ...(p.max_tokens ? { max_completion_tokens: p.max_tokens } : {}),
          ...(p.output_config?.effort ? { reasoning_effort: p.output_config.effort } : {}),
        };
        let res = await post(body);
        // modelo sem esforço de raciocínio configurável: tenta de novo sem ele
        if (res.status === 400 && 'reasoning_effort' in body) {
          delete body.reasoning_effort;
          res = await post(body);
        }
        if (!res.ok) throw new Error(`openai: HTTP ${res.status}`);
        const j = (await res.json()) as ChatResponse;
        const choice = j.choices?.[0];
        const usage = { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 };
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') return { stop_reason: 'refusal', parsed_output: null, usage };
        if (choice?.finish_reason === 'length') return { stop_reason: 'max_tokens', parsed_output: null, usage };
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(choice?.message?.content ?? '');
        } catch {
          parsed = null; // quem chama valida com zod e descarta (fail-closed)
        }
        return { stop_reason: 'end_turn', parsed_output: parsed, usage };
      },
    },
  };
}
