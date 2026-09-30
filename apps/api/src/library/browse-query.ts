import { GENRES, type GenreKey, genreTermsIn, normalizeMoodText, SUBGENRES } from '@fruiqo/taxonomy';

// D-23: buscas de "exploração" lidas LOCALMENTE (sem rede e sem LLM): "melhor série da Netflix",
// "melhor minissérie de suspense da netflix", "melhor curta da Apple TV", "melhor filme do Keanu
// Reeves na HBO", "lançamentos de terror", "filmes em breve". Viram um /discover ao vivo no TMDB
// (nada é copiado em massa: TOS-REQ-02). O que sobra do texto é tratado como nome de pessoa.

export type BrowseService = 'netflix' | 'prime' | 'disney' | 'max' | 'apple' | 'globoplay' | 'paramount' | 'mubi' | 'crunchyroll';

export interface BrowseInterpretation {
  /** "melhor", "melhores", "top", "mais bem avaliado": nota geral, com mínimo de votos */
  best: boolean;
  /** lançamentos recentes (últimos meses) ou os que ainda vão estrear */
  releases?: 'recent' | 'upcoming';
  services: BrowseService[];
  kind?: 'movie' | 'series';
  miniseries: boolean;
  short: boolean;
  genres: GenreKey[];
  /** palavras-chave do TMDB (ex.: super-herói) */
  keywordIds: number[];
  decade?: number;
  /** o que sobrou: provável nome de pessoa (ator/diretor) */
  person?: string;
  /** rótulos para mostrar como a busca foi entendida */
  labels: string[];
}

/** Serviços no Brasil: IDs de provedor do TMDB (watch_region=BR, só assinatura). */
export const SERVICES: { key: BrowseService; label: string; re: RegExp; tmdbIds: number[] }[] = [
  { key: 'netflix', label: 'Netflix', re: /\bnetflix\b/, tmdbIds: [8] },
  { key: 'prime', label: 'Prime Video', re: /\b((?:(?:na|no|da|do|de|em|pela|pelo) )?(?:amazon )?prime video|amazon prime( video)?|(?:na|no|da|do|de|em|pela|pelo) (?:amazon|prime))\b/, tmdbIds: [119] },
  { key: 'disney', label: 'Disney+', re: /\b(disney plus|disney)\b/, tmdbIds: [337] },
  { key: 'max', label: 'Max', re: /\b(hbo max|hbo|(?:na|no|da|do|de|em|pela|pelo) max)\b/, tmdbIds: [1899, 384] },
  { key: 'apple', label: 'Apple TV+', re: /\b((?:(?:na|no|da|do|de|em|pela|pelo) )?apple ?tv( plus)?|(?:na|no|da|do|de|em|pela|pelo) apple)\b/, tmdbIds: [350] },
  { key: 'globoplay', label: 'Globoplay', re: /\bgloboplay\b/, tmdbIds: [307] },
  { key: 'paramount', label: 'Paramount+', re: /\b(paramount plus|paramount)\b/, tmdbIds: [531] },
  { key: 'mubi', label: 'Mubi', re: /\bmubi\b/, tmdbIds: [11] },
  { key: 'crunchyroll', label: 'Crunchyroll', re: /\bcrunchyroll\b/, tmdbIds: [283] },
];

/** Temas sem gênero próprio: palavras-chave do TMDB. */
const KEYWORDS: { label: string; re: RegExp; id: number }[] = [
  { label: 'super-herói', re: /\b(super ?herois?|super-herois?|superherois?|superheroes?|superhero)\b/, id: 9715 },
  { label: 'viagem no tempo', re: /\bviage(m|ns) no tempo\b|\btime travel\b/, id: 4379 },
  { label: 'zumbi', re: /\bzumbis?\b|\bzombies?\b/, id: 12377 },
  { label: 'baseado em fatos reais', re: /\b(baseados? em|inspirados? em) (fatos|historias?) reais?\b|\bhistorias? reais?\b/, id: 9672 },
];

const BEST = /\b(melhor(es)?|top \d+|mais bem avaliad[oa]s?|bem avaliad[oa]s?|mais aclamad[oa]s?|aclamad[oa]s?|obras? primas?)\b/;
const UPCOMING = /\b(em breve|proximos lancamentos|proximas estreias|vao estrear|vai estrear|ainda vai estrear|chegando|que estreiam)\b/;
const RELEASES = /\b(lancamentos?|estreias?|em cartaz|nos cinemas|novidades?|acabou de sair|acabaram de sair|saiu agora|recem lancad[oa]s?)\b/;
const MINISERIES = /\b(mini ?series?|minisseries?)\b/;
const SHORT = /\b(curtas?[ -]?metrage(m|ns)|curtas?)\b/;
const MOVIE = /\b(filmes?|movies?|longas?[ -]?metrage(m|ns)|longas?)\b/;
const SERIES = /\b(series?|seriados?|tv shows?)\b/;
const DECADE = /\b(?:anos|decada de|decada)\s*(?:19)?([2-9]0|2000|2010|2020)\b|\b(?:19)?([2-9]0)s\b/;
const FILLER = new Set(
  'a o os as um uma de do da dos das e em no na nos nas com por para pra pro que qual quais tipo mais bom boa bons boas ja atual atuais agora ano anos disponivel disponiveis streaming assistir ver quero pelo pela estrelado estrelando ator atriz diretor direcao dirigido com'.split(' '),
);

/** null = não é uma busca de exploração (segue a busca normal por título/pessoa/gênero). */
export function interpretBrowseQuery(raw: string, kindParam?: 'movie' | 'series'): BrowseInterpretation | null {
  let n = normalizeMoodText(raw);
  const labels: string[] = [];
  const take = (re: RegExp): boolean => {
    if (!re.test(n)) return false;
    n = n.replace(new RegExp(re.source, 'g'), ' ');
    return true;
  };

  const best = take(BEST);
  const releases = take(UPCOMING) ? 'upcoming' : take(RELEASES) ? 'recent' : undefined;
  const services = SERVICES.filter((s) => take(s.re)).map((s) => s.key);
  const keywords = KEYWORDS.filter((k) => take(k.re));
  const miniseries = take(MINISERIES);
  const short = take(SHORT);
  // só com um sinal de exploração; "Duna" ou "terror anos 80" seguem pela busca normal
  if (!best && !releases && services.length === 0 && !miniseries && !short && keywords.length === 0) return null;

  const movieWord = take(MOVIE);
  const seriesWord = take(SERIES);
  const kind: 'movie' | 'series' | undefined =
    kindParam ?? (miniseries || (seriesWord && !movieWord) ? 'series' : short || (movieWord && !seriesWord) ? 'movie' : undefined);

  let decade: number | undefined;
  const dm = DECADE.exec(n);
  if (dm) {
    const v = dm[1] ?? dm[2]!;
    decade = v.length === 4 ? Number(v) : 1900 + Number(v);
    n = n.replace(DECADE, ' ');
  }

  const { genres, subgenres, rest } = genreTermsIn(n);
  const subGenres = subgenres.flatMap((s) => SUBGENRES.find((d) => d.key === s)?.rule.all ?? []);
  const allGenres = [...new Set<GenreKey>([...genres, ...subGenres])];
  const leftover = rest.split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));

  if (best) labels.push('mais bem avaliados');
  if (releases === 'recent') labels.push('lançamentos');
  if (releases === 'upcoming') labels.push('em breve');
  if (miniseries) labels.push('minissérie');
  else if (short) labels.push('curta-metragem');
  else if (kind) labels.push(kind === 'series' ? 'série' : 'filme');
  for (const g of allGenres) labels.push(GENRES.find((x) => x.key === g)?.label ?? g);
  for (const s of services) labels.push(SERVICES.find((x) => x.key === s)!.label);
  for (const k of keywords) labels.push(k.label);
  if (decade) labels.push(`anos ${String(decade).slice(2)}`);

  return {
    best,
    ...(releases ? { releases } : {}),
    services,
    ...(kind ? { kind } : {}),
    miniseries,
    short,
    genres: allGenres,
    keywordIds: keywords.map((k) => k.id),
    ...(decade ? { decade } : {}),
    ...(leftover.length ? { person: leftover.join(' ') } : {}),
    labels,
  };
}
