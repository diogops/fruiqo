// D-23: nota automática (0,5..5), calculada LOCALMENTE a partir do gosto do usuário: estrelas,
// marcações (assistido, abandonado, quero assistir), importações, perfil declarado e favoritos, pelo
// mesmo "encaixe" das sugestões (fit.ts). Sem LLM: dado do TMDB (gêneros, nota) não vai a prompt
// (ARB-REQ-06). A base é a nota geral (TMDB 0..10 → 0..5); sem ela, o meio da escala.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { recommendations, type RecommendationRow } from '../db/schema.js';
import { fitScore, type FitContext, type FitTitle } from './fit.js';
import { loadFitContext } from './fit-context.js';

/** quanto o gosto move a nota a partir da base (fit −1..1 → ±1,5 estrela) */
const TASTE_WEIGHT = 1.5;
const NEUTRAL_BASE = 3;
/** nota geral com menos votos que isto não vale (um voto 10 não é "o melhor") */
export const MIN_VOTES_FOR_GENERAL = 50;

export function trustedGeneral(voteAverage: number | null | undefined, voteCount: number | null | undefined): number | null {
  return voteAverage != null && (voteCount ?? 0) >= MIN_VOTES_FOR_GENERAL ? voteAverage : null;
}

/** Nota automática de um título; null sem base nenhuma (sem nota geral e sem gêneros). */
export function autoRating(t: FitTitle & { generalRating?: number | null }, ctx: FitContext): number | null {
  const fit = fitScore(t, ctx);
  const hasGeneral = t.generalRating != null;
  if (!hasGeneral && !fit.basis) return null;
  const base = hasGeneral ? t.generalRating! / 2 : NEUTRAL_BASE;
  const value = base + (fit.basis ? TASTE_WEIGHT * fit.score : 0);
  return Math.round(Math.max(0.5, Math.min(5, value)) * 10) / 10;
}

export function fitTitleOf(r: Pick<RecommendationRow, 'title' | 'genres' | 'resolution'>): FitTitle & { generalRating?: number | null } {
  const res = r.resolution;
  return {
    title: r.title,
    genres: r.genres,
    tmdbId: res?.provider === 'tmdb' ? (res.tmdbId ?? null) : null,
    mediaType: res?.provider === 'tmdb' ? (res.mediaType ?? null) : null,
    generalRating: res?.provider === 'tmdb' ? trustedGeneral(res.voteAverage, res.voteCount) : null,
  };
}

/**
 * Recalcula a nota automática dos títulos do usuário (dentro de withUser: RLS). Barato para um
 * catálogo pessoal; chamado quando o gosto muda (nota, status, import) e para preencher os que faltam.
 * `ids` limita aos informados; sem ele, todos. Devolve quantos mudaram.
 */
export async function recomputeAutoRatings(tx: Tx, ids?: readonly string[]): Promise<number> {
  const ctx = await loadFitContext(tx);
  const rows = await tx
    .select({ id: recommendations.id, title: recommendations.title, genres: recommendations.genres, resolution: recommendations.resolution, autoRating: recommendations.autoRating })
    .from(recommendations)
    .where(and(eq(recommendations.decision, 'cataloged'), ids ? inArray(recommendations.id, [...ids]) : undefined));
  const changes: { id: string; value: number | null }[] = [];
  for (const r of rows) {
    const next = autoRating(fitTitleOf(r), ctx);
    if (next !== r.autoRating) changes.push({ id: r.id, value: next });
  }
  // um UPDATE só (1.000 títulos em milissegundos, não um por um)
  for (let i = 0; i < changes.length; i += 1000) {
    const chunk = changes.slice(i, i + 1000);
    const idList = sql.join(chunk.map((c) => sql`${c.id}::uuid`), sql`, `);
    const values = sql.join(chunk.map((c) => sql`${c.value}::real`), sql`, `);
    await tx.execute(sql`
      UPDATE recommendations r SET auto_rating = v.value
        FROM unnest(ARRAY[${idList}], ARRAY[${values}]) AS v(id, value)
       WHERE r.id = v.id`);
  }
  return changes.length;
}
