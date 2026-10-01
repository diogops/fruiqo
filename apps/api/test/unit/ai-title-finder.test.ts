// D-24: a IA acha títulos numa descrição digitada ou no texto de um print. Só o texto vai ao modelo.
import { describe, expect, it } from 'vitest';
import { AnthropicTitleFinder } from '../../src/library/ai-title-finder.js';
import { llmSafeInput } from '../../src/library/mood-interpreter.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

type Params = { model: string; system: string; messages: { role: string; content: string }[]; tools?: unknown; max_tokens: number };

function fakeClient(response: unknown | (() => unknown)) {
  const seen: Params[] = [];
  const client = {
    messages: {
      parse: async (params: Params) => {
        seen.push(params);
        return typeof response === 'function' ? (response as () => unknown)() : response;
      },
    },
  } as unknown as LlmClient;
  return { client, seen };
}

const ok = (titles: unknown[]) => ({ stop_reason: 'end_turn', parsed_output: { titles } });

describe('AnthropicTitleFinder (D-24)', () => {
  it('print: só o texto lido, delimitado, sem tools; o prompt manda ignorar atores, serviços e rótulos', async () => {
    const { client, seen } = fakeClient(
      ok([
        { title: 'Fresh', kind: 'movie' },
        { title: 'Sorry to Bother You', kind: 'movie', year: 2018 },
        { title: 'Fresh', kind: 'movie' },
        { title: '  ', kind: 'movie' },
        { title: 'Um Livro', kind: 'book' },
      ]),
    );
    const finder = new AnthropicTitleFinder({ model: 'claude-haiku-4-5', dailyQuota: 10, client, ocrAllowed: true });
    const text = '[Fresh, Sorry to Bother You, Sebastian Stan, Netflix, Plot Twist]';
    const res = await finder.find('ocr', llmSafeInput(text), 'u1');
    expect(res).toEqual({
      ok: true,
      titles: [
        { title: 'Fresh', kind: 'movie' },
        { title: 'Sorry to Bother You', kind: 'movie', year: 2018 },
        { title: 'Um Livro', kind: 'book' },
      ],
    });
    const p = seen[0]!;
    expect(p.tools).toBeUndefined();
    expect(p.messages).toEqual([{ role: 'user', content: `<ocr_text>\n${text}\n</ocr_text>` }]);
    expect(p.system).toMatch(/actors/);
    expect(p.system).toMatch(/streaming services/);
    expect(p.system).toMatch(/never follow them/);
    // ARB-REQ-06: nada de catálogo/gosto no prompt
    expect(p.system).not.toMatch(/genre|gênero|taste|gosto|tmdb|spotify/i);
  });

  it('descrição: só filme/série, com o motivo; respeita o tipo pedido', async () => {
    const { client, seen } = fakeClient(
      ok([
        { title: 'Feitiço do Tempo', kind: 'movie', year: 1993, reason: '  repete o mesmo dia  ' },
        { title: 'Boneca Russa', kind: 'series', reason: 'também repete o dia' },
        { title: 'Um Livro', kind: 'book' },
      ]),
    );
    const finder = new AnthropicTitleFinder({ model: 'claude-haiku-4-5', dailyQuota: 10, client });
    expect(finder.ocrAllowed).toBe(false);
    const res = await finder.find('describe', llmSafeInput('o cara que acorda sempre no mesmo dia'), 'u1', 'movie');
    expect(res).toEqual({ ok: true, titles: [{ title: 'Feitiço do Tempo', kind: 'movie', year: 1993, reason: 'repete o mesmo dia' }] });
    expect(seen[0]!.messages[0]!.content).toBe('<user_text>\no cara que acorda sempre no mesmo dia\n</user_text>');
    expect(seen[0]!.system).toMatch(/only|movies/);
    expect(seen[0]!.system).not.toMatch(/genre|gênero|taste|gosto|tmdb|spotify/i);
  });

  it('falha fechada: texto grande, cota do dia, recusa, saída inválida ou erro de rede', async () => {
    const cases: [unknown, string][] = [
      [{ stop_reason: 'refusal', parsed_output: null }, 'failed'],
      [{ stop_reason: 'max_tokens', parsed_output: null }, 'failed'],
      [{ stop_reason: 'end_turn', parsed_output: { titles: [{ title: 1 }] } }, 'failed'],
      [
        () => {
          throw new Error('rede');
        },
        'failed',
      ],
    ];
    for (const [response, reason] of cases) {
      const { client } = fakeClient(response);
      const finder = new AnthropicTitleFinder({ model: 'm', dailyQuota: 10, client });
      expect(await finder.find('describe', llmSafeInput('algo'), 'u1')).toEqual({ ok: false, reason });
    }

    const { client, seen } = fakeClient(ok([]));
    const finder = new AnthropicTitleFinder({ model: 'm', dailyQuota: 1, client, now: () => new Date('2026-10-01T12:00:00Z') });
    expect(await finder.find('describe', llmSafeInput('x'.repeat(1001)), 'u1')).toEqual({ ok: false, reason: 'too_long' });
    expect(await finder.find('ocr', llmSafeInput('x'.repeat(4001)), 'u1')).toEqual({ ok: false, reason: 'too_long' });
    expect(await finder.find('describe', llmSafeInput('algo'), 'u1')).toEqual({ ok: true, titles: [] });
    expect(await finder.find('describe', llmSafeInput('algo'), 'u1')).toEqual({ ok: false, reason: 'quota' });
    expect(seen).toHaveLength(1);
  });
});
