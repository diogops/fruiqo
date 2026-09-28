import type { Resolution } from '@fruiqo/contracts';
import { type GenreKey, genresFromTmdb } from '@fruiqo/taxonomy';

/** Colunas do catálogo derivadas de uma resolução TMDB (gêneros próprios, duração, ano). */
export interface TmdbColumns {
  genres: GenreKey[];
  runtimeMin: number | null;
  year: number | null;
}

export function columnsFromResolution(res: Resolution | null | undefined): TmdbColumns | null {
  if (!res || res.provider !== 'tmdb') return null;
  const media = res.mediaType ?? (res.externalId.startsWith('tv:') ? 'tv' : 'movie');
  const weights = genresFromTmdb(res.genreIds ?? [], media);
  const genres = (Object.keys(weights) as GenreKey[]).filter((g) => (weights[g] ?? 0) > 0).sort();
  return { genres, runtimeMin: res.runtimeMin ?? null, year: res.year ?? null };
}

/**
 * Valores a gravar ao enriquecer um título. Gêneros marcados à mão (`manual`) nunca são
 * sobrescritos; o título continua `manual`, só ganha a resolução e a duração.
 */
export function enrichmentUpdate(
  current: { genres: string[]; enrichment: 'none' | 'tmdb' | 'demo' | 'manual'; runtimeMin: number | null; year: number | null },
  res: Resolution,
): { genres: string[]; enrichment: 'tmdb' | 'manual'; runtimeMin: number | null; year: number | null } {
  const cols = columnsFromResolution(res)!;
  const manual = current.enrichment === 'manual';
  return {
    genres: manual || cols.genres.length === 0 ? current.genres : cols.genres,
    enrichment: manual ? 'manual' : 'tmdb',
    runtimeMin: cols.runtimeMin ?? current.runtimeMin,
    year: current.year ?? cols.year,
  };
}
