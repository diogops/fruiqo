// Taxonomia v1 (docs/spec/taxonomy-v1.md §1). As chaves são próprias; os IDs do TMDB são só o
// mapeamento de entrada para o enriquecimento e o ranking local. Nada daqui com origem no TMDB
// vai para o LLM (ARB-REQ-02): o LLM só recebe as chaves próprias.

export const TAXONOMY_VERSION = 1;

export const GENRE_KEYS = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'music',
  'mystery',
  'romance',
  'scifi',
  'thriller',
  'war',
  'western',
  'reality',
] as const;
export type GenreKey = (typeof GENRE_KEYS)[number];

export interface GenreDef {
  key: GenreKey;
  label: string;
  /**
   * IDs de gênero do TMDB, conferidos com /genre/movie/list e /genre/tv/list em 2026-09-28.
   * Sem chave própria de propósito: 10770 (filme para TV), 10763 (News), 10766 (Soap), 10767 (Talk).
   */
  tmdbMovie: number[];
  tmdbTv: number[];
}

export const GENRES: readonly GenreDef[] = [
  { key: 'action', label: 'Ação', tmdbMovie: [28], tmdbTv: [10759] },
  { key: 'adventure', label: 'Aventura', tmdbMovie: [12], tmdbTv: [10759] },
  { key: 'animation', label: 'Animação', tmdbMovie: [16], tmdbTv: [16] },
  { key: 'comedy', label: 'Comédia', tmdbMovie: [35], tmdbTv: [35] },
  { key: 'crime', label: 'Crime', tmdbMovie: [80], tmdbTv: [80] },
  { key: 'documentary', label: 'Documentário', tmdbMovie: [99], tmdbTv: [99] },
  { key: 'drama', label: 'Drama', tmdbMovie: [18], tmdbTv: [18] },
  { key: 'family', label: 'Família', tmdbMovie: [10751], tmdbTv: [10751, 10762] },
  { key: 'fantasy', label: 'Fantasia', tmdbMovie: [14], tmdbTv: [10765] },
  { key: 'history', label: 'História', tmdbMovie: [36], tmdbTv: [] },
  { key: 'horror', label: 'Terror', tmdbMovie: [27], tmdbTv: [] },
  { key: 'music', label: 'Música/Musical', tmdbMovie: [10402], tmdbTv: [] },
  { key: 'mystery', label: 'Mistério', tmdbMovie: [9648], tmdbTv: [9648] },
  { key: 'romance', label: 'Romance', tmdbMovie: [10749], tmdbTv: [] },
  { key: 'scifi', label: 'Ficção científica', tmdbMovie: [878], tmdbTv: [10765] },
  { key: 'thriller', label: 'Suspense/Thriller', tmdbMovie: [53], tmdbTv: [] },
  { key: 'war', label: 'Guerra', tmdbMovie: [10752], tmdbTv: [10768] },
  { key: 'western', label: 'Faroeste', tmdbMovie: [37], tmdbTv: [37] },
  { key: 'reality', label: 'Reality', tmdbMovie: [], tmdbTv: [10764] },
];

/**
 * Converte IDs de gênero do TMDB em pesos por chave própria. Na TV, os gêneros combinados
 * (10759 Action & Adventure, 10765 Sci-Fi & Fantasy, 10768 War & Politics) valem 0,5 para cada chave.
 */
export function genresFromTmdb(
  ids: readonly number[],
  media: 'movie' | 'tv',
): Partial<Record<GenreKey, number>> {
  const out: Partial<Record<GenreKey, number>> = {};
  for (const id of ids) {
    const matches = GENRES.filter((g) => (media === 'movie' ? g.tmdbMovie : g.tmdbTv).includes(id));
    const weight = matches.length > 1 ? 0.5 : 1;
    for (const g of matches) out[g.key] = Math.max(out[g.key] ?? 0, weight);
  }
  return out;
}
