import { GENRE_KEYS, type GenreKey, interpretTasteStatement, type SubgenreKey } from '@fruiqo/taxonomy';
import type { Tx } from '../db/client.js';
import { overrideScore, recommendations, tasteFavorites, tasteOverrides, tasteSignals, tasteStatements, tasteSubgenrePrefs } from '../db/schema.js';
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
    if (GENRE_SET.has(o.genre)) signals[o.genre as GenreKey] = overrideScore(o);
  }
  // subgênero marcado à mão vale por cima do que o resumo declarado diz
  const liked = new Set<SubgenreKey>(interp?.likedSubgenres ?? []);
  const disliked = new Set<SubgenreKey>(interp?.dislikedSubgenres ?? []);
  for (const p of await tx.select().from(tasteSubgenrePrefs)) {
    const key = p.subgenre as SubgenreKey;
    (p.pref === 'like' ? liked : disliked).add(key);
    (p.pref === 'like' ? disliked : liked).delete(key);
  }

  return {
    declared: declaredAffinity(favorites, interp),
    likedSubgenres: liked,
    dislikedSubgenres: disliked,
    signals,
    notes: notesByGenre(cataloged),
    favorites: favorites.map((f) => ({ title: f.title, genres: f.genres, rating: f.rating, tmdbId: f.tmdbId, mediaType: f.mediaType })),
  };
}
