// Chaves de IA para o comparativo, lidas dos .env de outros projetos do dono, só em memória.
// Nada é impresso nem gravado. A chave da Anthropic vem do ambiente (railway run injeta a da produção).
import { readFileSync } from 'node:fs';

function readEnv(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
    return out;
  } catch {
    return {};
  }
}

const inconta = readEnv('D:/Desenvolvimento/Inconta/backendAtual/.env');
const procredito = readEnv('D:/Desenvolvimento/ProcreditoWeb/src/backend/.env.bak-1780745683');
const fruiqo = readEnv(new URL('../../apps/api/.env', import.meta.url));

export const KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY || '',
  gemini: inconta.GEMINI_API_KEY || inconta.GOOGLE_API_KEY || '',
  mistral: inconta.MISTRAL_API_KEY || procredito.MISTRAL_API_KEY || '',
  openai: procredito.OPENAI_API_KEY || '',
  // TMDB (conferência local dos títulos): a do .env do Fruiqo, ou a da produção via railway run
  tmdb: fruiqo.TMDB_API_KEY || process.env.TMDB_API_KEY || '',
};
