import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { AnthropicInterpreter, llmSafeInput } from '../../src/library/mood-interpreter.js';
import { AnthropicTitleGuesser } from '../../src/library/title-guesser.js';
import { aiAvailability } from '../../src/library/user-settings.js';
import type { LlmClient } from '../../src/pipeline/gateway.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
};
const TMDB = { TMDB_API_KEY: 'tmdb-token-que-nao-pode-aparecer', PIPELINE_MODE: 'live' };

describe('guarda D-07: TMDB ativo × IA (C-15)', () => {
  it('recusa TMDB ativo com LLM_ENABLED', () => {
    expect(() => loadEnv({ ...BASE, ...TMDB, LLM_ENABLED: 'true' })).toThrow(/TMDB_AI_CLEARANCE.*D-07/);
  });

  it('recusa TMDB ativo com AI_MODE=anthropic (mesmo sem chave da Anthropic)', () => {
    expect(() => loadEnv({ ...BASE, ...TMDB, AI_MODE: 'anthropic' })).toThrow(/D-07/);
  });

  it('a mensagem não expõe o valor do token', () => {
    try {
      loadEnv({ ...BASE, ...TMDB, AI_MODE: 'anthropic' });
    } catch (err) {
      expect((err as Error).message).not.toContain(TMDB.TMDB_API_KEY);
      return;
    }
    throw new Error('deveria ter falhado');
  });

  it('aceita TMDB ativo com IA desligada (configuração atual)', () => {
    expect(() => loadEnv({ ...BASE, ...TMDB, AI_MODE: 'rules', LLM_ENABLED: 'false' })).not.toThrow();
  });

  it('aceita IA ligada sem TMDB, e TMDB + IA em mock (testes/eval)', () => {
    expect(() => loadEnv({ ...BASE, AI_MODE: 'anthropic', LLM_ENABLED: 'true' })).not.toThrow();
    expect(() => loadEnv({ ...BASE, ...TMDB, PIPELINE_MODE: 'mock', AI_MODE: 'anthropic' })).not.toThrow();
  });

  it('só libera com TMDB_AI_CLEARANCE=confirmed (definido após a resposta escrita do TMDB)', () => {
    expect(() => loadEnv({ ...BASE, ...TMDB, AI_MODE: 'anthropic', TMDB_AI_CLEARANCE: 'confirmed' })).not.toThrow();
    expect(() => loadEnv({ ...BASE, ...TMDB, TMDB_AI_CLEARANCE: 'sim' })).toThrow();
  });

  it('explica à UI por que a IA está indisponível', () => {
    const env = loadEnv({ ...BASE, ...TMDB });
    expect(aiAvailability(env)).toEqual({ aiAvailable: false, aiUnavailableReason: 'tmdb_clearance_pending' });
    expect(aiAvailability(loadEnv({ ...BASE }))).toEqual({ aiAvailable: false, aiUnavailableReason: 'disabled' });
  });
});

describe('ARB-REQ-06: nada do TMDB/Spotify (nem derivado) entra em prompt de LLM', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../src');
  const llmModules = ['library/mood-interpreter.ts', 'pipeline/extractors/anthropic.ts', 'library/title-guesser.ts'];
  // fontes de dados de terceiros ou do catálogo (gêneros/providers derivados do TMDB)
  const forbidden = [/resolvers\//, /\/db\//, /schema/, /library\.service/, /catalog/, /ranking/, /providers/, /enrichment/, /tmdb/i, /spotify/i, /user-settings/];

  for (const mod of llmModules) {
    it(`${mod} não importa nada que carregue dados de catálogo/terceiros`, () => {
      const src = readFileSync(join(root, mod), 'utf-8');
      const imports = [...src.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]!);
      for (const imp of imports) {
        for (const re of forbidden) expect(imp, `${mod} importa ${imp}`).not.toMatch(re);
      }
    });
  }

  it('o prompt do "Como estou" é só o texto do usuário delimitado (sem resumo de gosto, C-16)', async () => {
    const seen: unknown[] = [];
    const client = {
      messages: {
        parse: async (params: unknown) => {
          seen.push(params);
          return { parsed_output: null, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    } as unknown as LlmClient;
    const interpreter = new AnthropicInterpreter({
      model: 'claude-haiku-4-5',
      maxInputChars: 1000,
      dailyQuota: 10,
      pricing: { inPerMTok: 1, outPerMTok: 5 },
      client,
    });
    await interpreter.interpret(llmSafeInput('quero algo leve'), 'u1');
    expect(seen).toHaveLength(1);
    const params = seen[0] as { messages: { role: string; content: string }[]; system: string; tools?: unknown };
    expect(params.tools).toBeUndefined();
    expect(params.messages).toEqual([{ role: 'user', content: '<user_text>\nquero algo leve\n</user_text>' }]);
    expect(params.system).not.toMatch(/genre|gênero|taste|gosto|tmdb|spotify/i);
  });

  it('RF-46: o palpite de título por descrição recebe só o texto digitado (sem tools, sem catálogo)', async () => {
    const seen: unknown[] = [];
    const client = {
      messages: {
        parse: async (params: unknown) => {
          seen.push(params);
          return { parsed_output: { titles: [{ title: 'Algum Filme', kind: 'movie' }] }, stop_reason: 'end_turn' };
        },
      },
    } as unknown as LlmClient;
    const guesser = new AnthropicTitleGuesser({ model: 'claude-haiku-4-5', maxInputChars: 1000, dailyQuota: 10, client });
    expect(await guesser.guess(llmSafeInput('filme do cara preso no mesmo dia'), 'u1')).toEqual([{ title: 'Algum Filme', kind: 'movie' }]);
    const params = seen[0] as { messages: { role: string; content: string }[]; system: string; tools?: unknown };
    expect(params.tools).toBeUndefined();
    expect(params.messages).toEqual([{ role: 'user', content: '<user_text>\nfilme do cara preso no mesmo dia\n</user_text>' }]);
    expect(params.system).not.toMatch(/genre|gênero|taste|gosto|tmdb|spotify/i);
  });
});
