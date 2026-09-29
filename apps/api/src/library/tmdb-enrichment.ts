import type { Resolution } from '@fruiqo/contracts';
import { type GenreKey, genresFromSubjects, genresFromTmdb } from '@fruiqo/taxonomy';

/** Colunas do catálogo derivadas de uma resolução (TMDB: filmes/séries; Open Library: livros, RF-48). */
export interface TmdbColumns {
  genres: GenreKey[];
  runtimeMin: number | null;
  year: number | null;
  enrichment: 'tmdb' | 'openlibrary';
}

export function columnsFromResolution(res: Resolution | null | undefined): TmdbColumns | null {
  if (!res) return null;
  if (res.provider === 'openlibrary') {
    return { genres: [...genresFromSubjects(res.subjects ?? [])].sort(), runtimeMin: null, year: res.year ?? null, enrichment: 'openlibrary' };
  }
  if (res.provider !== 'tmdb') return null;
  const media = res.mediaType ?? (res.externalId.startsWith('tv:') ? 'tv' : 'movie');
  const weights = genresFromTmdb(res.genreIds ?? [], media);
  const genres = (Object.keys(weights) as GenreKey[]).filter((g) => (weights[g] ?? 0) > 0).sort();
  return { genres, runtimeMin: res.runtimeMin ?? null, year: res.year ?? null, enrichment: 'tmdb' };
}

/**
 * Valores a gravar ao enriquecer um título. Gêneros marcados à mão (`manual`) nunca são
 * sobrescritos; o título continua `manual`, só ganha a resolução e a duração.
 */
export function enrichmentUpdate(
  current: { genres: string[]; enrichment: 'none' | 'tmdb' | 'openlibrary' | 'demo' | 'manual'; runtimeMin: number | null; year: number | null },
  res: Resolution,
): { genres: string[]; enrichment: 'tmdb' | 'openlibrary' | 'manual'; runtimeMin: number | null; year: number | null } {
  const cols = columnsFromResolution(res)!;
  const manual = current.enrichment === 'manual';
  return {
    genres: manual || cols.genres.length === 0 ? current.genres : cols.genres,
    enrichment: manual ? 'manual' : cols.enrichment,
    runtimeMin: cols.runtimeMin ?? current.runtimeMin,
    year: current.year ?? cols.year,
  };
}
