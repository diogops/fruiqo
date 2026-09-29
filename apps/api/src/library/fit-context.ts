import { GENRE_KEYS, type GenreKey, interpretTasteStatement } from '@fruiqo/taxonomy';
import type { Tx } from '../db/client.js';
import { recommendations, tasteFavorites, tasteOverrides, tasteSignals, tasteStatements } from '../db/schema.js';
import { declaredAffinity, type FitContext, notesByGenre } from './fit.js';
import { tasteFromSignals } from './ranking.js';

const GENRE_SET = new Set<string>(GENRE_KEYS);

/**
 * Tudo o que o encaixe (RF-42/43/44) precisa, lido dentro de withUser (RLS): perfil declarado,
 * sinais (com overrides do perfil) e notas dos títulos catalogados.
 */
export async function loadFitContext(tx: Tx): Promise<FitContext> {
  const favorites = await tx.select().from(tasteFavorites);
  const [statement] = await tx.select().from(tasteStatements);
  const interp = statement?.summary ? interpretTasteStatement(statement.summary) : null;

  const titles = await tx
    .select({ id: recommendations.id, genres: recommendations.genres, rating: recommendations.rating, decision: recommendations.decision })
    .from(recommendations);
  const cataloged = titles.filter((t) => t.decision === 'cataloged');
  const genresOf = new Map(cataloged.map((t) => [t.id, t.genres.filter((g): g is GenreKey => GENRE_SET.has(g))]));
  const signalRows = await tx.select().from(tasteSignals);
  const signals = tasteFromSignals(
    signalRows
      .filter((r) => r.recommendationId && genresOf.has(r.recommendationId))
      .map((r) => ({ signal: r.signal, value: r.value, genres: genresOf.get(r.recommendationId!)! })),
  );
  for (const o of await tx.select().from(tasteOverrides)) {
    if (GENRE_SET.has(o.genre)) signals[o.genre as GenreKey] = o.mode === 'pin' ? 1 : -1;
  }

  return {
    declared: declaredAffinity(favorites, interp),
    likedSubgenres: new Set(interp?.likedSubgenres ?? []),
    dislikedSubgenres: new Set(interp?.dislikedSubgenres ?? []),
    signals,
    notes: notesByGenre(cataloged),
    favorites: favorites.map((f) => ({ title: f.title, genres: f.genres, rating: f.rating, tmdbId: f.tmdbId, mediaType: f.mediaType })),
  };
}
