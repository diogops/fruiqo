// D-25: plano de busca do "O que assistir hoje?". O pedido em texto vira um plano com vocabulário
// próprio (gêneros da taxonomia + atributos qualitativos); quem procura as obras é o servidor
// (Minha Área, /discover do TMDB), nunca a IA. O parser local resolve o comum sem custo; a IA só
// interpreta o que ele não entendeu, devolvendo o MESMO formato (enums fechados).
import { GENRE_KEYS, type GenreKey, genreTermsIn } from '@fruiqo/taxonomy';

/** Atributos qualitativos (ontologia própria). `keywords`: nomes de palavras-chave do TMDB, resolvidos no servidor. */
export const ATTRIBUTES = {
  thought_provoking: {
    label: 'faz pensar',
    terms: ['inteligente', 'inteligentes', 'que faca pensar', 'que me faca pensar', 'faz pensar', 'reflexivo', 'reflexao', 'cerebral', 'filosofico', 'profundo', 'cabeca'],
    // sem "dystopia": muita ação pós-apocalíptica (Mad Max) entrava como "inteligente"
    keywords: ['philosophy', 'artificial intelligence', 'existentialism', 'moral dilemma', 'consciousness'],
  },
  complex_plot: {
    label: 'trama complexa',
    terms: ['complexo', 'complexa', 'quebra cabeca', 'nao linear', 'enigmatico', 'mind bending', 'confuso'],
    keywords: ['nonlinear timeline', 'time loop', 'time travel', 'parallel world'],
  },
  plot_twist: {
    label: 'com reviravolta',
    terms: ['reviravolta', 'reviravoltas', 'plot twist', 'final surpreendente', 'final inesperado', 'twist'],
    keywords: ['twist ending', 'plot twist'],
  },
  light_tone: {
    label: 'leve',
    terms: ['leve', 'levinho', 'relaxar', 'tranquilo', 'descontraido', 'despretensioso', 'sessao da tarde'],
    keywords: ['feel-good', 'lighthearted'],
  },
  feel_good: {
    label: 'para cima',
    terms: ['feel good', 'alto astral', 'inspirador', 'motivador', 'otimista', 'pra cima'],
    keywords: ['feel-good', 'inspirational'],
  },
  true_story: {
    label: 'história real',
    terms: ['historia real', 'fatos reais', 'baseado em fatos reais', 'caso real', 'biografia', 'biografico'],
    keywords: ['based on true story', 'biography'],
  },
  epic: {
    label: 'épico',
    terms: ['epico', 'grandioso', 'superproducao'],
    keywords: ['epic'],
  },
  emotional: {
    label: 'emocionante',
    terms: ['emocionante', 'chorar', 'comovente', 'tocante', 'sensivel'],
    keywords: ['tearjerker'],
  },
  fast_paced: {
    label: 'ritmo rápido',
    terms: ['sem enrolacao', 'ritmo rapido', 'agil', 'frenetico', 'eletrizante'],
    keywords: [],
  },
  short: {
    label: 'curto',
    terms: ['curto', 'curtinho', 'rapidinho', 'nao muito longo'],
    keywords: [],
  },
} as const satisfies Record<string, { label: string; terms: readonly string[]; keywords: readonly string[] }>;
export type Attr = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as Attr[];

export interface TonightPlan {
  /** todos ao mesmo tempo */
  genresAll: GenreKey[];
  /** qualquer um destes */
  genresAny: GenreKey[];
  /** nenhum destes */
  genresNone: GenreKey[];
  prefer: Attr[];
  avoid: Attr[];
  /** ex.: 1980 para "anos 80" */
  decade?: number;
  /** trechos relevantes que não viraram nada (mostrados ao usuário; motivo para chamar a IA) */
  unmapped: string[];
}

export const EMPTY_PLAN: TonightPlan = { genresAll: [], genresAny: [], genresNone: [], prefer: [], avoid: [], unmapped: [] };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** palavras que não carregam pedido (não viram "não entendi") */
const STOP = new Set(
  'quero queria assistir ver filme filmes serie series um uma uns umas bom boa bons boas que seja sejam mas e de do da dos das algo hoje pra para me eu com muito muita mais tipo alguma algum coisa legal hoje agora tambem ou nao noite assim isso esse essa ai la uns tenha tenham tiver ser sendo estou to tô esta ta'
    .split(' '),
);

/** "sem terror", "nada de romance", "não quero drama", "evitar comédia" → exclusões */
const NEGATION = /\b(?:sem|nada de|nao quero|evitar|evite|menos|exceto)\s+([a-z0-9\s-]{2,40}?)(?=,|;|\.| e | mas | com | que |$)/g;

function attrsIn(text: string): Attr[] {
  return ATTRIBUTE_KEYS.filter((a) => ATTRIBUTES[a].terms.some((t) => new RegExp(`(^|\\s)${t}(\\s|$)`).test(text)));
}

function stripAttrs(text: string): string {
  let rest = text;
  for (const a of ATTRIBUTE_KEYS) for (const t of ATTRIBUTES[a].terms) rest = rest.replace(new RegExp(`(^|\\s)${t}(?=\\s|$)`, 'g'), ' ');
  return rest;
}

/** Parser local (sem IA): gêneros, exclusões, alternativas, atributos e década. */
export function localPlan(raw: string): TonightPlan {
  let text = norm(raw);
  const plan: TonightPlan = { genresAll: [], genresAny: [], genresNone: [], prefer: [], avoid: [], unmapped: [] };
  if (!text) return plan;

  // exclusões primeiro (e saem do texto)
  for (const m of text.matchAll(NEGATION)) {
    const seg = m[1] ?? '';
    plan.genresNone.push(...genreTermsIn(seg).genres);
    plan.avoid.push(...attrsIn(seg));
  }
  text = text.replace(NEGATION, ' ');

  const decade = /\banos\s+([2-9])0\b/.exec(text);
  if (decade) {
    plan.decade = Number(decade[1]) >= 2 && Number(decade[1]) <= 9 ? 1900 + Number(decade[1]) * 10 : undefined;
    text = text.replace(decade[0], ' ');
  }
  if (/\banos\s+(2000|dois mil)\b/.test(text)) {
    plan.decade = 2000;
    text = text.replace(/\banos\s+(2000|dois mil)\b/, ' ');
  }

  plan.prefer = attrsIn(text);
  text = stripAttrs(text);

  // "ação ou comédia" = qualquer um; senão, todos ao mesmo tempo
  const parts = text.split(/\s+ou\s+/);
  const perPart = parts.map((p) => genreTermsIn(p));
  const withGenres = perPart.filter((p) => p.genres.length > 0);
  if (withGenres.length >= 2) plan.genresAny = withGenres.flatMap((p) => p.genres);
  else plan.genresAll = perPart.flatMap((p) => p.genres);

  // o que sobrou e parece pedido: "não entendi" (motivo para chamar a IA)
  const rest = perPart.map((p) => p.rest).join(' ');
  plan.unmapped = [...new Set(rest.split(' ').filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))].slice(0, 6);
  return dedupe(plan);
}

function dedupe(p: TonightPlan): TonightPlan {
  const none = new Set(p.genresNone);
  const avoid = new Set(p.avoid);
  return {
    ...p,
    genresAll: [...new Set(p.genresAll)].filter((g) => !none.has(g)),
    genresAny: [...new Set(p.genresAny)].filter((g) => !none.has(g)),
    genresNone: [...none],
    prefer: [...new Set(p.prefer)].filter((a) => !avoid.has(a)),
    avoid: [...avoid],
  };
}

const GENRE_SET = new Set<string>(GENRE_KEYS);
const ATTR_SET = new Set<string>(ATTRIBUTE_KEYS);

/** Plano vindo da IA: só enums conhecidos, listas curtas, sem contradição (fail-closed por item). */
export function sanitizePlan(p: {
  genresAll?: string[];
  genresAny?: string[];
  genresNone?: string[];
  prefer?: string[];
  avoid?: string[];
  decade?: number | null;
  unmapped?: string[];
}): TonightPlan {
  const g = (l?: string[]) => (l ?? []).filter((x): x is GenreKey => GENRE_SET.has(x)).slice(0, 4);
  const a = (l?: string[]) => (l ?? []).filter((x): x is Attr => ATTR_SET.has(x)).slice(0, 4);
  const decade = p.decade && p.decade >= 1920 && p.decade <= 2030 && p.decade % 10 === 0 ? p.decade : undefined;
  return dedupe({
    genresAll: g(p.genresAll),
    genresAny: g(p.genresAny),
    genresNone: g(p.genresNone),
    prefer: a(p.prefer),
    avoid: a(p.avoid),
    ...(decade ? { decade } : {}),
    unmapped: (p.unmapped ?? []).map((s) => s.slice(0, 40)).slice(0, 6),
  });
}

/** O que foi entendido, em português (mostrado na tela). */
export function planLabel(p: TonightPlan, genreLabel: (g: GenreKey) => string): string {
  const parts: string[] = [];
  if (p.genresAll.length) parts.push(p.genresAll.map(genreLabel).join(' + '));
  if (p.genresAny.length) parts.push(p.genresAny.map(genreLabel).join(' ou '));
  if (p.prefer.length) parts.push(p.prefer.map((x) => ATTRIBUTES[x].label).join(', '));
  if (p.decade) parts.push(`anos ${String(p.decade).slice(2)}`);
  if (p.genresNone.length) parts.push(`sem ${p.genresNone.map(genreLabel).join(', ').toLowerCase()}`);
  if (p.avoid.length) parts.push(`nada ${p.avoid.map((x) => ATTRIBUTES[x].label).join(', ')}`);
  return parts.join(' · ');
}

export function planIsEmpty(p: TonightPlan): boolean {
  return !p.genresAll.length && !p.genresAny.length && !p.genresNone.length && !p.prefer.length && !p.avoid.length && !p.decade;
}
