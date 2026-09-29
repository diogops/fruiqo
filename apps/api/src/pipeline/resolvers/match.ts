import { normalizeForKey } from '../dedup.js';

// RF-47: aderência de um resultado do catálogo ao texto importado (título, ano, tipo), 0..1.
// Local e determinístico; os dados do TMDB usados aqui nunca vão para o LLM (ARB-REQ-02).

/** Similaridade por distância de edição (Levenshtein), 0..1, sem acento, caixa e pontuação. */
export function similarity(a: string, b: string): number {
  const x = normalizeForKey(a);
  const y = normalizeForKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dist = levenshtein(x, y);
  let sim = 1 - dist / Math.max(x.length, y.length);
  // título importado contido no título do catálogo ("Monstro" → "Dahmer - Monstro: A História…"):
  // costuma ser o mesmo título com subtítulo; o ano decide entre os candidatos
  const words = (s: string) => ` ${s} `;
  // quanto mais do título do catálogo o texto cobre, melhor ("Monstro" → "O Monstro" > "… O Monstro de Bangalore")
  if (x.length >= 4 && (words(y).includes(words(x)) || words(x).includes(words(y)))) {
    const cover = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    sim = Math.max(sim, 0.8 + 0.2 * cover);
  }
  return Math.max(0, Math.min(1, sim));
}

function levenshtein(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const cur = [j];
    for (let i = 1; i <= a.length; i++) {
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[a.length]!;
}

export interface MatchQuery {
  title: string;
  year?: number;
  /** tipo pedido pelo texto (cabeçalho "Series:", contexto…) */
  mediaType?: 'movie' | 'tv';
}

export interface MatchCandidate {
  title: string;
  originalTitle?: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  popularity?: number;
}

/** Abaixo disto o match é fraco: vai para a revisão com alternativas em destaque. */
export const STRONG_MATCH = 0.8;

/**
 * Pontuação do candidato: título (60%), ano (25%) e tipo (15%). Ano divergente em mais de 1
 * derruba o match para "fraco" mesmo com título idêntico (ex.: "Monstro (2022)" × série de 2026).
 */
export function matchScore(q: MatchQuery, c: MatchCandidate): number {
  const sim = Math.max(similarity(q.title, c.title), c.originalTitle ? similarity(q.title, c.originalTitle) : 0);
  let yearScore = 0.6;
  let yearOff = false;
  if (q.year && c.year) {
    const diff = Math.abs(q.year - c.year);
    yearScore = diff === 0 ? 1 : diff === 1 ? 0.8 : 0;
    yearOff = diff > 1;
  } else if (q.year && !c.year) {
    yearScore = 0.3;
  }
  const kindScore = q.mediaType ? (q.mediaType === c.mediaType ? 1 : 0.4) : 0.7;
  const pop = c.popularity ? Math.min(1, Math.log10(c.popularity + 1) / 3) : 0;
  let score = 0.6 * sim + 0.25 * yearScore + 0.15 * kindScore + 0.02 * pop;
  if (yearOff) score = Math.min(score, 0.55);
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}
