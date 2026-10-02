// D-25: plano de busca do "O que assistir hoje?". O pedido em texto vira um plano com vocabulário
// próprio (gêneros da taxonomia + atributos qualitativos); quem procura as obras é o servidor
// (Minha Área, /discover do TMDB), nunca a IA. O parser local resolve o comum sem custo; a IA só
// interpreta o que ele não entendeu, devolvendo o MESMO formato (enums fechados).
import { GENRE_KEYS, type GenreKey, genreTermsIn } from '@fruiqo/taxonomy';

/**
 * Atributos qualitativos (ontologia própria).
 * - `keywords`: nomes de palavras-chave do TMDB (resolvidos no servidor pelo nome; evidência forte);
 * - `like` / `avoid`: pista de gêneros (evidência mais fraca; `avoid` sai da busca quando pedido);
 * - `maxRuntime`: duração máxima (filmes), quando o atributo é sobre tempo.
 */
export const ATTRIBUTES = {
  thought_provoking: {
    label: 'faz pensar',
    terms: ['inteligente', 'inteligentes', 'que faca pensar', 'que me faca pensar', 'faz pensar', 'reflexivo', 'reflexao', 'cerebral', 'filosofico', 'profundo', 'cabeca'],
    // sem "dystopia": muita ação pós-apocalíptica (Mad Max) entrava como "inteligente"
    keywords: ['philosophy', 'artificial intelligence (a.i.)', 'existentialism', 'moral dilemma', 'consciousness'],
    like: ['scifi', 'drama', 'mystery'],
    avoid: [],
  },
  complex_plot: {
    label: 'trama complexa',
    terms: ['complexo', 'complexa', 'quebra cabeca', 'nao linear', 'enigmatico', 'mind bending', 'confuso'],
    keywords: ['nonlinear timeline', 'time loop', 'time travel', 'parallel world'],
    like: ['mystery', 'thriller', 'scifi'],
    avoid: [],
  },
  plot_twist: {
    label: 'com reviravolta',
    terms: ['reviravolta', 'reviravoltas', 'plot twist', 'plot twists', 'final surpreendente', 'final inesperado', 'twist', 'que engana', 'que enganam', 'enganam ate o fim', 'engana ate o fim', 'surpreende no final'],
    keywords: ['twist ending', 'plot twist'],
    like: ['thriller', 'mystery'],
    avoid: [],
  },
  light_tone: {
    label: 'leve',
    terms: ['leve', 'levinho', 'relaxar', 'relaxante', 'tranquilo', 'descontraido', 'despretensioso', 'sessao da tarde', 'cansado', 'cansada', 'exausto', 'exausta', 'esgotado', 'esgotada', 'sem pensar muito'],
    keywords: ['feel good', 'lighthearted'],
    like: ['comedy', 'family', 'romance', 'adventure'],
    avoid: ['horror', 'war', 'thriller', 'crime'],
  },
  feel_good: {
    label: 'para cima',
    terms: ['feel good', 'alto astral', 'inspirador', 'motivador', 'otimista', 'pra cima', 'animado', 'animada', 'feliz'],
    keywords: ['feel good', 'inspirational'],
    like: ['comedy', 'family', 'music', 'romance'],
    avoid: ['horror', 'war'],
  },
  true_story: {
    label: 'história real',
    terms: ['baseado em historia real', 'baseada em historia real', 'baseado em fatos reais', 'baseada em fatos reais', 'historia real', 'historias reais', 'fatos reais', 'caso real', 'biografia', 'biografico', 'cinebiografia'],
    keywords: ['based on true story', 'biography'],
    like: ['history', 'documentary', 'drama'],
    avoid: [],
    // define a obra (não é um "jeito"): só entra com a palavra-chave do TMDB comprovando
    required: true,
  },
  epic: {
    label: 'épico',
    terms: ['epico', 'grandioso', 'superproducao'],
    keywords: ['epic'],
    like: ['adventure', 'history', 'war', 'fantasy'],
    avoid: [],
  },
  emotional: {
    label: 'emocionante',
    terms: ['emocionante', 'chorar', 'pra chorar', 'comovente', 'tocante', 'sensivel', 'triste'],
    // poucas obras têm "tearjerker": perda, luto e doença terminal, só em drama (themeGenres), sem ação/suspense/terror
    keywords: ['tearjerker', 'terminal illness', 'loss of loved one', 'grief', 'dying and death'],
    like: ['drama', 'romance'],
    avoid: ['action', 'thriller', 'horror'],
    themeGenres: ['drama'],
  },
  fast_paced: {
    label: 'ritmo rápido',
    terms: ['sem enrolacao', 'ritmo rapido', 'agil', 'frenetico', 'eletrizante'],
    keywords: [],
    like: ['action', 'thriller'],
    avoid: [],
  },
  ai_topic: {
    label: 'inteligência artificial',
    terms: ['inteligencia artificial', 'robo', 'robos', 'androide', 'androides', 'ciborgue', 'maquinas que pensam'],
    keywords: ['artificial intelligence (a.i.)', 'android', 'robot', 'cyborg'],
    like: ['scifi'],
    avoid: [],
    // é o assunto da obra: só com a palavra-chave comprovando
    required: true,
  },
  detective: {
    label: 'investigação',
    terms: ['detetive', 'detetives', 'investigacao', 'investigacoes', 'investigador', 'investigadora', 'investigativo', 'investigativa'],
    keywords: ['detective', 'police detective', 'investigation', 'murder investigation'],
    like: ['crime', 'mystery'],
    avoid: [],
  },
  short: {
    label: 'curto',
    terms: ['curto', 'curta', 'curtinho', 'curtinha', 'rapidinho', 'rapidinha', 'nao muito longo', 'nao muito longa', 'rapido de ver', 'de menos de 2 horas', 'menos de duas horas'],
    keywords: [],
    like: [],
    avoid: [],
    maxRuntime: 100,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    terms: readonly string[];
    keywords: readonly string[];
    like: readonly GenreKey[];
    avoid: readonly GenreKey[];
    maxRuntime?: number;
    required?: boolean;
    /** na busca por palavra-chave, a obra também tem de ser de um destes gêneros */
    themeGenres?: readonly GenreKey[];
  }
>;
export type Attr = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as Attr[];

/**
 * Origem da obra ("nórdico", "coreano", "nacional"): requisito, como gênero. Na busca vira
 * `with_origin_country` do TMDB; na Minha Área, confere país de origem / produção da obra.
 */
export const ORIGINS = {
  nordic: {
    label: 'nórdico',
    terms: ['nordico', 'nordica', 'nordicos', 'nordicas', 'escandinavo', 'escandinava', 'escandinavos', 'escandinavas', 'sueco', 'sueca', 'dinamarques', 'dinamarquesa', 'noruegues', 'norueguesa', 'islandes', 'islandesa', 'finlandes', 'finlandesa'],
    countries: ['SE', 'NO', 'DK', 'FI', 'IS'],
  },
  korean: { label: 'coreano', terms: ['coreano', 'coreana', 'coreanos', 'coreanas', 'kdrama', 'k drama', 'dorama', 'doramas'], countries: ['KR'] },
  japanese: { label: 'japonês', terms: ['japones', 'japonesa', 'japoneses', 'japonesas'], countries: ['JP'] },
  brazilian: { label: 'brasileiro', terms: ['brasileiro', 'brasileira', 'brasileiros', 'brasileiras', 'nacional', 'nacionais'], countries: ['BR'] },
  french: { label: 'francês', terms: ['frances', 'francesa', 'franceses', 'francesas'], countries: ['FR'] },
  spanish: { label: 'espanhol', terms: ['espanhol', 'espanhola', 'espanhois', 'espanholas'], countries: ['ES'] },
  british: { label: 'britânico', terms: ['britanico', 'britanica', 'britanicos', 'britanicas'], countries: ['GB'] },
  italian: { label: 'italiano', terms: ['italiano', 'italiana', 'italianos', 'italianas'], countries: ['IT'] },
  german: { label: 'alemão', terms: ['alemao', 'alema', 'alemaes'], countries: ['DE'] },
  indian: { label: 'indiano', terms: ['indiano', 'indiana', 'indianos', 'bollywood'], countries: ['IN'] },
  latin_american: { label: 'latino-americano', terms: ['latino', 'latina', 'latinos', 'mexicano', 'mexicana', 'argentino', 'argentina', 'colombiano', 'colombiana', 'chileno', 'chilena'], countries: ['MX', 'AR', 'CO', 'CL'] },
  turkish: { label: 'turco', terms: ['turco', 'turca', 'turcos'], countries: ['TR'] },
} as const satisfies Record<string, { label: string; terms: readonly string[]; countries: readonly string[] }>;
export type Origin = keyof typeof ORIGINS;
export const ORIGIN_KEYS = Object.keys(ORIGINS) as Origin[];

/** Países (ISO 3166) das origens pedidas. */
export function originCountries(plan: TonightPlan): string[] {
  return [...new Set((plan.origins ?? []).flatMap((o) => [...ORIGINS[o].countries]))];
}

/** Atributos que a obra TEM de ter (comprovados por palavra-chave do TMDB), não só preferência. */
export function requiredAttrs(plan: TonightPlan): Attr[] {
  return plan.prefer.filter((a) => (ATTRIBUTES[a] as { required?: boolean }).required);
}

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
  /** origem da obra (requisito): "nórdico" → SE/NO/DK/FI/IS */
  origins?: Origin[];
  /**
   * Obras de referência ("igual a X", "parecido com X", "mesma premissa de X"), como o usuário
   * escreveu: a busca usa as recomendações/semelhantes de X no TMDB e a IA compara a premissa.
   */
  references?: string[];
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
  'sobre estou quero queria assistir ver filme filmes serie series um uma uns umas bom boa bons boas que seja sejam mas e de do da dos das algo hoje pra para me eu com muito muita mais tipo alguma algum coisa legal hoje agora tambem ou nao noite assim isso esse essa ai la uns tenha tenham tiver ser sendo estou to tô esta ta'
    .split(' '),
);

/** "igual(is) a X", "parecido(s) com X", "no estilo de X", "mesma premissa de X" → X é obra de referência */
const REFERENCE =
  /\b(?:igua(?:l|is)(?:zinh[oa]s?)?|parecid[oa]s?|semelhantes?|similar(?:es)?|no estilo|estilo|mesma (?:premissa|pegada|vibe|historia|ideia|linha))\s+(?:(?:a|ao|aos|as|com|de|do|da|dos|das)\s+)?(?:(?:o|a|os|as)\s+)?([a-z0-9][a-z0-9 :'-]{1,60}?)(?=\s*(?:,|;|\.|$)|\s+(?:que|e que|mas|com|sem|so que)\s)/g;

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

  // obra de referência primeiro: o nome dela sai do texto (senão "Os Horrores de Caddo Lake" vira terror)
  const refs: string[] = [];
  text = text.replace(REFERENCE, (_m, title: string) => {
    const t = title.trim();
    const { genres, rest } = genreTermsIn(t);
    // "parecido com algo leve" não é obra; "tipo um suspense" também não
    if (!t || /^(algo|alguma coisa|coisa|um|uma|uns|umas)\b/.test(t) || (genres.length > 0 && !rest.trim()) || attrsIn(t).length > 0) return _m;
    refs.push(t);
    return ' ';
  });
  if (refs.length) plan.references = [...new Set(refs)].slice(0, 3);

  plan.prefer = attrsIn(text);
  text = stripAttrs(text);
  // origem ("nórdico", "coreano"): requisito; sai do texto para não virar "não entendi"
  const origins = ORIGIN_KEYS.filter((o) => ORIGINS[o].terms.some((t) => new RegExp(`(^|\\s)${t}(\\s|$)`).test(text)));
  if (origins.length) {
    plan.origins = origins;
    for (const o of origins) for (const t of ORIGINS[o].terms) text = text.replace(new RegExp(`(^|\\s)${t}(?=\\s|$)`, 'g'), ' ');
  }

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
const ORIGIN_SET = new Set<string>(ORIGIN_KEYS);

/** Plano vindo da IA: só enums conhecidos, listas curtas, sem contradição (fail-closed por item). */
export function sanitizePlan(p: {
  genresAll?: string[];
  genresAny?: string[];
  genresNone?: string[];
  prefer?: string[];
  avoid?: string[];
  decade?: number | null;
  origins?: string[];
  references?: string[];
  unmapped?: string[];
}): TonightPlan {
  const g = (l?: string[]) => (l ?? []).filter((x): x is GenreKey => GENRE_SET.has(x)).slice(0, 4);
  const a = (l?: string[]) => (l ?? []).filter((x): x is Attr => ATTR_SET.has(x)).slice(0, 4);
  const decade = p.decade && p.decade >= 1920 && p.decade <= 2030 && p.decade % 10 === 0 ? p.decade : undefined;
  const origins = [...new Set((p.origins ?? []).filter((x): x is Origin => ORIGIN_SET.has(x)))].slice(0, 3);
  const references = [...new Set((p.references ?? []).map((r) => r.trim().slice(0, 80)).filter((r) => r.length >= 2))].slice(0, 3);
  return dedupe({
    ...(origins.length ? { origins } : {}),
    ...(references.length ? { references } : {}),
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
  if (p.references?.length) parts.push(`com a mesma pegada de ${p.references.join(' e ')}`);
  if (p.origins?.length) parts.push(p.origins.map((o) => ORIGINS[o].label).join(' ou '));
  if (p.decade) parts.push(`anos ${String(p.decade).slice(2)}`);
  if (p.genresNone.length) parts.push(`sem ${p.genresNone.map(genreLabel).join(', ').toLowerCase()}`);
  if (p.avoid.length) parts.push(`nada ${p.avoid.map((x) => ATTRIBUTES[x].label).join(', ')}`);
  return parts.join(' · ');
}

export function planIsEmpty(p: TonightPlan): boolean {
  return !p.genresAll.length && !p.genresAny.length && !p.genresNone.length && !p.prefer.length && !p.avoid.length && !p.decade && !p.origins?.length && !p.references?.length;
}
