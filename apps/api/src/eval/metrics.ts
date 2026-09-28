import { detectRisk, interpretMood, MoodIntentSchema } from '@fruiqo/taxonomy';
import { normalizeForKey } from '../pipeline/dedup.js';
import type { ExpectedShare, MoodCase } from './fixtures.js';

// Métricas do RF-22. Funções puras: recebem o que o pipeline produziu e o expected.json.

export interface PredictedItem {
  title: string;
  kind: string;
  creator?: string | null;
  decision: 'cataloged' | 'review_queue';
  resolutionId?: string | null;
}

export interface PredictedShare {
  status: string;
  items: PredictedItem[];
  source: { platform: string; url: string | null };
  dedup: { pagesIgnored: number; itemsAlreadyInList: number };
  costUsd: number;
}

export interface ShareScore {
  tp: number;
  fp: number;
  fn: number;
  kindHits: number;
  resolutionHits: number;
  resolutionExpected: number;
  review: number;
  /** checagens binárias (status, fonte, dedup, proibidos): id → passou */
  assertions: Record<string, boolean>;
  missing: string[];
  unexpected: string[];
}

/** Casamento por título normalizado (sem numeração, ano e pontuação); o tipo é medido à parte. */
const key = (title: string) => normalizeForKey(title);

export function scoreShare(pred: PredictedShare, exp: ExpectedShare, prefix: string): ShareScore {
  const predByKey = new Map(pred.items.map((p) => [key(p.title), p]));
  const expKeys = new Set(exp.items.map((e) => key(e.title)));
  let tp = 0;
  let kindHits = 0;
  let resolutionHits = 0;
  let resolutionExpected = 0;
  const missing: string[] = [];
  for (const e of exp.items) {
    const p = predByKey.get(key(e.title));
    if (e.tmdbId) resolutionExpected++;
    if (!p) {
      missing.push(e.title);
      continue;
    }
    tp++;
    if (p.kind === e.kind) kindHits++;
    if (e.tmdbId && p.resolutionId === e.tmdbId) resolutionHits++;
  }
  const unexpected = pred.items.filter((p) => !expKeys.has(key(p.title))).map((p) => p.title);

  const assertions: Record<string, boolean> = {};
  if (exp.status) assertions[`${prefix}status`] = pred.status === exp.status;
  if (exp.source) {
    assertions[`${prefix}source.platform`] = pred.source.platform === exp.source.platform;
    if (exp.source.url) assertions[`${prefix}source.url`] = pred.source.url === exp.source.url;
  }
  if (exp.dedup) {
    assertions[`${prefix}dedup.pagesIgnored`] = pred.dedup.pagesIgnored === exp.dedup.pagesIgnored;
    assertions[`${prefix}dedup.itemsAlreadyInList`] = pred.dedup.itemsAlreadyInList === exp.dedup.itemsAlreadyInList;
  }
  for (const f of exp.forbidden) {
    const fk = key(f);
    assertions[`${prefix}forbidden:${f}`] = !pred.items.some((p) => key(p.title) === fk);
  }

  return {
    tp,
    fp: unexpected.length,
    fn: missing.length,
    kindHits,
    resolutionHits,
    resolutionExpected,
    review: pred.items.filter((p) => p.decision === 'review_queue').length,
    assertions,
    missing,
    unexpected,
  };
}

export interface MoodScore {
  riskPositives: number;
  riskDetected: number;
  riskNegatives: number;
  riskFalsePositives: number;
  intentCases: number;
  intentConverged: number;
  failures: string[];
}

/** RNF-07 (recall do detector) e convergência do RulesInterpreter com a taxonomia (RF-33, parte local). */
export function scoreMood(cases: MoodCase[]): MoodScore {
  const s: MoodScore = { riskPositives: 0, riskDetected: 0, riskNegatives: 0, riskFalsePositives: 0, intentCases: 0, intentConverged: 0, failures: [] };
  for (const c of cases) {
    const risk = detectRisk(c.text).risk;
    if (c.risk) {
      s.riskPositives++;
      if (risk) s.riskDetected++;
      else s.failures.push(`risco não detectado: "${c.text}"`);
    } else {
      s.riskNegatives++;
      if (risk) {
        s.riskFalsePositives++;
        s.failures.push(`falso positivo de risco: "${c.text}"`);
      }
    }
    if (!c.intent) continue;
    s.intentCases++;
    const intent = interpretMood(c.text);
    const ok =
      MoodIntentSchema.safeParse(intent).success &&
      (c.intent.schemaOnly ||
        ((!c.intent.need || intent.need === c.intent.need) &&
          (!c.intent.energy || intent.energy === c.intent.energy) &&
          (c.intent.maxRuntimeMin === undefined || intent.maxRuntimeMin === c.intent.maxRuntimeMin) &&
          (c.intent.avoidIncludes ?? []).every((a) => (intent.avoid as string[]).includes(a))));
    if (ok) s.intentConverged++;
    else s.failures.push(`intenção divergente: "${c.text}" → ${JSON.stringify({ need: intent.need, energy: intent.energy, avoid: intent.avoid })}`);
  }
  return s;
}

export function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return precision === null || recall === null ? null : 0;
  return (2 * precision * recall) / (precision + recall);
}
