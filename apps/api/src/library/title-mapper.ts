import type { Resolution, Title } from '@fruiqo/contracts';
import { GENRE_KEYS, type GenreKey, subgenresFromGenres } from '@fruiqo/taxonomy';
import type { RecommendationRow } from '../db/schema.js';
import { GENRE_LABEL, SUBGENRE_LABEL } from './ranking.js';

const GENRE_SET = new Set<string>(GENRE_KEYS);

export function toTitle(r: RecommendationRow, lists: { id: string; name: string }[]): Title {
  const genres = r.genres.filter((g): g is GenreKey => GENRE_SET.has(g));
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    ...(r.creator ? { creator: r.creator } : {}),
    ...(r.year != null ? { year: r.year } : {}),
    status: r.status,
    rank: r.rank,
    ...(r.rating != null ? { rating: r.rating } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    genres: genres.map((key) => ({ key, label: GENRE_LABEL.get(key)! })),
    subgenres: subgenresFromGenres(genres).map((key) => ({ key, label: SUBGENRE_LABEL.get(key)! })),
    ...(r.runtimeMin != null ? { runtimeMin: r.runtimeMin } : {}),
    enrichment: r.enrichment,
    ...tmdbDisplay(r.resolution),
    decision: r.decision,
    ...(r.suggestedDecision ? { suggestedDecision: r.suggestedDecision } : {}),
    ...(r.matchScore != null ? { matchScore: r.matchScore } : {}),
    confidence: r.confidence,
    extractor: r.extractor,
    ...(r.resolution ? { resolution: r.resolution } : {}),
    shareId: r.shareId,
    lists,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Campos de exibição vindos do TMDB (2d). Sem resolução TMDB, nada é exposto. */
function tmdbDisplay(res: Resolution | null): Pick<Title, 'posterUrl' | 'overview' | 'watchProvidersBR' | 'watchUrl' | 'bookUrl' | 'pages'> {
  // RF-48: livro (Open Library): capa pela URL pública, sinopse e "onde encontrar" = página da obra
  if (res?.provider === 'openlibrary') {
    return {
      ...(res.imageUrl ? { posterUrl: res.imageUrl } : {}),
      ...(res.overview ? { overview: res.overview } : {}),
      ...(res.url ? { bookUrl: res.url } : {}),
      ...(res.pages ? { pages: res.pages } : {}),
    };
  }
  if (!res || res.provider !== 'tmdb') return {};
  const providers =
    res.providers ?? (res.watchProvidersBR ?? []).map((name) => ({ name, type: 'flatrate' as const }));
  return {
    ...(res.imageUrl ? { posterUrl: res.imageUrl } : {}),
    ...(res.overview ? { overview: res.overview } : {}),
    ...(providers.length > 0 ? { watchProvidersBR: providers } : {}),
    ...(res.watchUrl ? { watchUrl: res.watchUrl } : {}),
  };
}
