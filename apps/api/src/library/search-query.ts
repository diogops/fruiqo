import { GENRES, type GenreKey, genreTermsIn, normalizeMoodText, SUBGENRES } from '@fruiqo/taxonomy';

// RF-46: leitura LOCAL da busca (sem rede e sem LLM). Decide se o texto parece título (com ou sem
// ano), gênero/tema/década ou uma descrição livre. Pessoa (ator/diretor) é decidida depois, com o
// resultado do TMDB (o nome só é reconhecível lá).

export interface SearchInterpretation {
  /** tipo provável antes de consultar o catálogo */
  type: 'title' | 'genre' | 'description';
  /** texto para a busca por título/pessoa (sem o ano) */
  text: string;
  year?: number;
  /** início da década (1980 = anos 80) */
  decade?: number;
  genres: GenreKey[];
  kind?: 'movie' | 'series';
  /** texto longo que pode ser descrição, se a busca por título não achar nada parecido */
  maybeDescription: boolean;
  /** palavras de conteúdo (fallback por palavras-chave de uma descrição) */
  keywords: string[];
}

const KIND_WORDS: { kind: 'movie' | 'series'; re: RegExp }[] = [
  { kind: 'movie', re: /\b(filmes?|movies?|longas?)\b/ },
  { kind: 'series', re: /\b(series?|seriados?|minisseries?|tv shows?)\b/ },
];

const STOPWORDS = new Set(
  'a o os as um uma uns umas de do da dos das e em no na nos nas com sem por para pra pro que qual quais sobre tipo algum alguma bom boa bons boas melhor melhores anos decada the of and in on to with about como onde quando esse essa aquele aquela isso isto ele ela eles elas seu sua'.split(' '),
);

const DECADE = /\b(?:anos|decada de|decada)\s*(?:19)?([2-9]0|2000|2010|2020)\b|\b(?:19)?([2-9]0)s\b/;
const TRAILING_YEAR = /[\s(]*\b(18[89]\d|19\d\d|20\d\d)\)?\s*$/;

export function interpretSearchQuery(raw: string, kindParam?: 'movie' | 'series'): SearchInterpretation {
  const q = raw.trim();
  const n = normalizeMoodText(q);
  const kindWord = KIND_WORDS.find((k) => k.re.test(n))?.kind;
  const kind = kindParam ?? kindWord;

  // década ("anos 90", "década de 80", "90s")
  let decade: number | undefined;
  const dm = DECADE.exec(n);
  if (dm) {
    const v = dm[1] ?? dm[2]!;
    decade = v.length === 4 ? Number(v) : 1900 + Number(v);
  }

  // gênero/tema: só quando o texto é SÓ gênero/tipo/década ("terror anos 80", "comédia romântica")
  const { genres, subgenres, rest } = genreTermsIn(q);
  const leftover = rest
    .replace(DECADE, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && !KIND_WORDS.some((k) => k.re.test(w)));
  const subGenres = subgenres.flatMap((s) => {
    const def = SUBGENRES.find((d) => d.key === s);
    return def?.rule.all ?? [];
  });
  const allGenres = [...new Set<GenreKey>([...genres, ...subGenres])];
  if ((allGenres.length > 0 || decade) && leftover.length === 0) {
    return { type: 'genre', text: q, ...(decade ? { decade } : {}), genres: allGenres, ...(kind ? { kind } : {}), maybeDescription: false, keywords: [] };
  }

  // título com ano no fim ("Duna 2021", "Monstro (2022)")
  let text = q;
  let year: number | undefined;
  const ym = TRAILING_YEAR.exec(q);
  if (ym && ym.index > 0) {
    year = Number(ym[1]);
    text = q.slice(0, ym.index).trim();
  }

  const words = normalizeMoodText(text).split(' ').filter(Boolean);
  const keywords = [...new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)))].sort((a, b) => b.length - a.length).slice(0, 3);
  return {
    type: 'title',
    text,
    ...(year ? { year } : {}),
    genres: [],
    ...(kind ? { kind } : {}),
    maybeDescription: !year && words.length >= 5,
    keywords,
  };
}

/** IDs de gênero do TMDB para o /discover (filme e TV têm tabelas próprias). */
export function tmdbGenreIds(genres: GenreKey[], media: 'movie' | 'tv'): number[] {
  return [...new Set(genres.flatMap((g) => GENRES.find((d) => d.key === g)?.[media === 'movie' ? 'tmdbMovie' : 'tmdbTv'] ?? []))];
}
