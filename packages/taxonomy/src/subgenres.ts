import type { GenreKey } from './genres.js';

// Taxonomia v1 §2. Regra R = combinação de gêneros base. As regras K (keywords do TMDB, DEPENDE DA
// FASE 0) e L (tag do LLM só com título/ano, D-06) entram na 2d; aqui fica só o que é local.

export const SUBGENRE_KEYS = [
  'romcom',
  'slapstick',
  'dark_comedy',
  'feelgood',
  'tearjerker',
  'psych_thriller',
  'mind_bender',
  'slasher',
  'supernatural_horror',
  'heist',
  'coming_of_age',
  'inspirational',
  'comfort',
  'true_crime',
  'epic',
] as const;
export type SubgenreKey = (typeof SUBGENRE_KEYS)[number];

/** Todos de `all`, pelo menos um de cada grupo de `anyOf` e nenhum de `none`. */
export interface GenreRule {
  all?: GenreKey[];
  anyOf?: GenreKey[][];
  none?: GenreKey[];
}

export interface SubgenreDef {
  key: SubgenreKey;
  label: string;
  rule: GenreRule;
  /** keywords do TMDB por nome (uso em recomendação: DEPENDE DA FASE 0) */
  keywords: string[];
}

export const SUBGENRES: readonly SubgenreDef[] = [
  { key: 'romcom', label: 'Comédia romântica', rule: { all: ['comedy', 'romance'] }, keywords: ['romantic comedy'] },
  {
    key: 'slapstick',
    label: 'Comédia pastelão / besteirol',
    rule: { all: ['comedy'], none: ['drama', 'romance'] },
    keywords: ['slapstick', 'spoof', 'parody'],
  },
  {
    key: 'dark_comedy',
    label: 'Comédia de humor ácido',
    rule: { all: ['comedy'], anyOf: [['crime', 'drama']] },
    keywords: ['dark comedy', 'black comedy'],
  },
  {
    key: 'feelgood',
    label: 'Feel-good',
    rule: { anyOf: [['comedy', 'family', 'animation']], none: ['horror', 'thriller'] },
    keywords: ['feel-good'],
  },
  { key: 'tearjerker', label: 'Pra chorar', rule: { all: ['drama'], anyOf: [['romance', 'family']] }, keywords: ['tearjerker'] },
  {
    key: 'psych_thriller',
    label: 'Thriller psicológico',
    rule: { all: ['thriller'], anyOf: [['mystery', 'drama']] },
    keywords: ['psychological thriller'],
  },
  {
    key: 'mind_bender',
    label: 'De explodir a cabeça',
    rule: { all: ['scifi'], anyOf: [['mystery', 'thriller']] },
    keywords: ['mind-bending', 'nonlinear timeline'],
  },
  { key: 'slasher', label: 'Terror slasher', rule: { all: ['horror'] }, keywords: ['slasher'] },
  {
    key: 'supernatural_horror',
    label: 'Terror sobrenatural',
    rule: { all: ['horror'], anyOf: [['fantasy', 'mystery']] },
    keywords: ['supernatural'],
  },
  { key: 'heist', label: 'Assalto / golpe', rule: { all: ['crime'], anyOf: [['thriller', 'action']] }, keywords: ['heist'] },
  { key: 'coming_of_age', label: 'Amadurecimento', rule: { anyOf: [['drama', 'comedy']] }, keywords: ['coming of age'] },
  {
    key: 'inspirational',
    label: 'Superação / inspirador',
    rule: { anyOf: [['drama', 'documentary', 'history']] },
    keywords: ['based on true story', 'overcoming adversity', 'inspirational'],
  },
  {
    key: 'comfort',
    label: 'Conforto (reassistir sem esforço)',
    rule: { anyOf: [['animation', 'family', 'comedy']] },
    keywords: ['cozy'],
  },
  { key: 'true_crime', label: 'True crime', rule: { all: ['documentary', 'crime'] }, keywords: ['true crime'] },
  {
    key: 'epic',
    label: 'Épico',
    rule: { all: ['adventure'], anyOf: [['history', 'war', 'fantasy']] },
    keywords: ['epic'],
  },
];

export function matchesRule(rule: GenreRule, genres: ReadonlySet<GenreKey>): boolean {
  if (rule.all && !rule.all.every((g) => genres.has(g))) return false;
  if (rule.anyOf && !rule.anyOf.every((group) => group.some((g) => genres.has(g)))) return false;
  if (rule.none && rule.none.some((g) => genres.has(g))) return false;
  return true;
}

/** Subgêneros derivados só pela regra R (combinação de gêneros). */
export function subgenresFromGenres(genres: Iterable<GenreKey>): SubgenreKey[] {
  const set = new Set(genres);
  return SUBGENRES.filter((s) => matchesRule(s.rule, set)).map((s) => s.key);
}
