import { GENRE_KEYS, type GenreKey } from './genres.js';
import { SUBGENRES, type SubgenreKey } from './subgenres.js';
import { normalizeMoodText, termRegex } from './text.js';

// RF-43: interpretação LOCAL (por regras) do resumo livre de gosto do perfil. Sem rede e sem LLM
// (D-07); o resultado é mostrado ao usuário, que corrige o que estiver errado (RNF-10).
// A frase é quebrada em trechos ("gosto de X, mas não de Y"); num trecho com negação
// ("não gosto", "odeio", "evito"…), tudo o que ele cita vira "não gosto".

const GENRE_TERMS: Record<GenreKey, string[]> = {
  action: ['acao', 'luta', 'lutas', 'porradaria', 'tiroteio'],
  adventure: ['aventura', 'aventuras'],
  animation: ['animacao', 'animacoes', 'desenho', 'desenhos', 'anime', 'animes'],
  comedy: ['comedia', 'comedias', 'humor', 'engracado', 'engracados', 'engracadas', 'rir'],
  crime: ['crime', 'crimes', 'policial', 'policiais', 'mafia', 'gangster', 'gangsters', 'true crime', 'serial killer*'],
  documentary: ['documentario', 'documentarios', 'doc', 'docs', 'true crime', 'historia real', 'historias reais', 'baseado em fatos', 'fatos reais'],
  drama: ['drama', 'dramas', 'dramatico', 'dramaticos', 'dramatica'],
  family: ['familia', 'infantil', 'infantis', 'criancas'],
  fantasy: ['fantasia', 'fantasias', 'magia', 'magico', 'dragoes', 'medieval'],
  history: ['historico', 'historicos', 'historica', 'historicas', 'de epoca', 'epoca'],
  horror: ['terror', 'horror', 'susto', 'sustos', 'assombracao', 'zumbi*'],
  music: ['musical', 'musicais'],
  mystery: ['misterio', 'misterios', 'investigacao', 'investigacoes', 'detetive', 'detetives', 'whodunit'],
  romance: ['romance', 'romances', 'romantico', 'romanticos', 'romantica', 'romanticas', 'amor', 'casal'],
  scifi: ['ficcao cientifica', 'sci fi', 'scifi', 'espaco', 'futurista', 'futuristas', 'distopia', 'distopias', 'distopico', 'viagem no tempo', 'alienigena*'],
  thriller: ['suspense', 'suspenses', 'thriller', 'thrillers', 'tensao', 'psicologico', 'psicologicos'],
  war: ['guerra', 'guerras', 'militar'],
  western: ['faroeste', 'faroestes', 'western', 'velho oeste'],
  reality: ['reality', 'realities', 'reality show', 'reality shows'],
  biography: ['biografia', 'biografias', 'memorias', 'autobiografia', 'autobiografias'],
  nonfiction: ['nao ficcao', 'nao-ficcao', 'ensaio', 'ensaios', 'divulgacao cientifica', 'jornalismo'],
  poetry: ['poesia', 'poesias', 'poemas', 'poeta', 'poetas'],
  young_adult: ['infantojuvenil', 'infanto juvenil', 'juvenil', 'young adult', 'ya'],
  self_help: ['autoajuda', 'auto ajuda', 'desenvolvimento pessoal', 'produtividade'],
};

const SUBGENRE_TERMS: Partial<Record<SubgenreKey, string[]>> = {
  romcom: ['comedia romantica', 'comedias romanticas', 'romcom'],
  slapstick: ['besteirol', 'pastelao', 'comedia pastelao', 'besteira'],
  dark_comedy: ['humor negro', 'humor acido', 'comedia acida'],
  feelgood: ['feel good', 'feelgood', 'para cima', 'pra cima', 'alto astral', 'leve', 'leves'],
  tearjerker: ['pra chorar', 'para chorar', 'chorar', 'choro', 'emocionante', 'emocionantes'],
  psych_thriller: ['thriller psicologico', 'suspense psicologico', 'thrillers psicologicos'],
  mind_bender: ['explodir a cabeca', 'mind blowing', 'plot twist', 'plot twists', 'reviravolta', 'reviravoltas'],
  slasher: ['slasher', 'slashers'],
  supernatural_horror: ['sobrenatural', 'sobrenaturais', 'terror sobrenatural', 'espiritos', 'possessao'],
  heist: ['assalto', 'assaltos', 'golpe', 'golpes', 'roubo', 'roubos'],
  coming_of_age: ['amadurecimento', 'adolescente', 'adolescentes', 'coming of age'],
  inspirational: ['superacao', 'inspirador', 'inspiradores', 'inspiradora', 'motivacional'],
  comfort: ['aconchegante', 'conforto', 'reassistir'],
  true_crime: ['true crime', 'crime real', 'crimes reais'],
  epic: ['epico', 'epicos', 'epica', 'epicas'],
};

const NEGATIVE_CUES = [
  'nao gosto',
  'nao curto',
  'nao suporto',
  'nao aguento',
  'nao sou fa',
  'nao assisto',
  'nao vejo',
  'nao quero',
  'odeio',
  'detesto',
  'evito',
  'nada de',
  'sem paciencia',
  'dispenso',
  'tenho medo',
  'me irrita',
  'nao me pega',
  'nao',
];

/** "não perco uma comédia" é elogio, não negação */
const POSITIVE_DESPITE_NEGATION = ['nao perco', 'nao canso', 'nao dispenso', 'nao vivo sem', 'nao resisto', 'nao abro mao'];

export interface TasteStatementInterpretation {
  likes: GenreKey[];
  dislikes: GenreKey[];
  likedSubgenres: SubgenreKey[];
  dislikedSubgenres: SubgenreKey[];
}

/** Trechos da frase: vírgula, ponto, "mas", "porém", "já", "e não". */
function clauses(normalized: string): string[] {
  return normalized
    .replace(/\b(mas|porem|contudo|entretanto|so que|ja)\b/g, '|')
    .replace(/\be (?=nao\b)/g, '|')
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
}

function mentions(clause: string, terms: string[]): boolean {
  return terms.some((t) => termRegex(t).test(clause));
}

/**
 * Resumo livre → gêneros/subgêneros de que o usuário gosta ou não gosta. Um subgênero citado não
 * conta também como os gêneros dele (ex.: "comédia romântica" não vira "romance" solto), para o
 * "não gosto de comédia romântica" não excluir toda comédia.
 */
export function interpretTasteStatement(rawText: string): TasteStatementInterpretation {
  // pontuação vira quebra de trecho antes da normalização (que troca pontuação por espaço)
  const text = rawText.replace(/[.;!?\n,]+/g, ' | ');
  const likes = new Set<GenreKey>();
  const dislikes = new Set<GenreKey>();
  const likedSub = new Set<SubgenreKey>();
  const dislikedSub = new Set<SubgenreKey>();

  for (const part of text.split('|')) {
    for (const clause of clauses(normalizeMoodText(part))) {
      const negative =
        NEGATIVE_CUES.some((cue) => termRegex(cue).test(clause)) &&
        !POSITIVE_DESPITE_NEGATION.some((cue) => termRegex(cue).test(clause));
      let rest = clause;
      for (const s of SUBGENRES) {
        const terms = SUBGENRE_TERMS[s.key] ?? [];
        const all = [...terms, normalizeMoodText(s.label)];
        if (!mentions(rest, all)) continue;
        (negative ? dislikedSub : likedSub).add(s.key);
        // remove o trecho do subgênero para não contar os gêneros dele de novo
        for (const t of all) rest = rest.replace(termRegex(t), ' ');
      }
      for (const g of GENRE_KEYS) {
        if (mentions(rest, GENRE_TERMS[g])) (negative ? dislikes : likes).add(g);
      }
    }
  }
  // quem aparece nos dois lados fica só como "não gosto" (fail-safe: não empurrar o que foi rejeitado)
  for (const g of dislikes) likes.delete(g);
  for (const s of dislikedSub) likedSub.delete(s);
  return {
    likes: [...likes],
    dislikes: [...dislikes],
    likedSubgenres: [...likedSub],
    dislikedSubgenres: [...dislikedSub],
  };
}

function strip(text: string, terms: string[]): string {
  let rest = text;
  for (const t of terms) {
    const re = termRegex(t);
    while (re.test(rest)) rest = rest.replace(re, ' ');
  }
  return rest;
}

/**
 * RF-46: gêneros/subgêneros citados num texto curto (busca) e o que sobra depois de tirá-los. Sobra
 * vazia (ou só palavras de ligação) = a busca é por gênero, não por título ("terror anos 80").
 */
export function genreTermsIn(rawText: string): { genres: GenreKey[]; subgenres: SubgenreKey[]; rest: string } {
  let rest = normalizeMoodText(rawText);
  const genres: GenreKey[] = [];
  const subgenres: SubgenreKey[] = [];
  for (const s of SUBGENRES) {
    const all = [...(SUBGENRE_TERMS[s.key] ?? []), normalizeMoodText(s.label)];
    if (!mentions(rest, all)) continue;
    subgenres.push(s.key);
    rest = strip(rest, all);
  }
  for (const g of GENRE_KEYS) {
    if (!mentions(rest, GENRE_TERMS[g])) continue;
    genres.push(g);
    rest = strip(rest, GENRE_TERMS[g]);
  }
  return { genres, subgenres, rest: rest.replace(/\s+/g, ' ').trim() };
}
