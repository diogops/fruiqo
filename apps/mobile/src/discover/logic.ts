// Lógica pura da home/descoberta/listas (sem React), testada em __tests__/logic.test.ts.
import {
  type DiscoverRequest,
  type FeedbackAction,
  type FeedbackRequest,
  type HomePreset,
  type Suggestion,
  type TaxonomyTag,
  type Title,
  DiscoverRequestSchema,
  FeedbackRequestSchema,
} from '@fruiqo/contracts';

export const MOOD_MAX_CHARS = 500;

/** "Surpreenda-me" a partir de um preset do /home (subgênero ou gênero da taxonomia). */
export function buildSurpriseRequest(preset: Pick<HomePreset, 'key' | 'kind'>): DiscoverRequest {
  const body = preset.kind === 'subgenre' ? { subgenre: preset.key } : { genre: preset.key };
  return DiscoverRequestSchema.parse({ mode: 'surprise', ...body });
}

/** "Como estou": null se o texto estiver vazio depois do trim. Nunca guarda o texto (RNF-06). */
export function buildMoodRequest(text: string, continueAfterRisk = false): DiscoverRequest | null {
  const trimmed = text.trim().slice(0, MOOD_MAX_CHARS);
  if (!trimmed) return null;
  return DiscoverRequestSchema.parse({ mode: 'mood', text: trimmed, ...(continueAfterRisk ? { continueAfterRisk: true } : {}) });
}

export function buildFeedback(
  runId: string,
  titleId: string,
  action: FeedbackAction,
  reasonTag?: string,
): FeedbackRequest {
  return FeedbackRequestSchema.parse({ runId, titleId, action, ...(reasonTag ? { reasonTag } : {}) });
}

/**
 * Tira da lista a sugestão que recebeu feedback e, se a API mandou uma próxima que ainda não
 * está na tela, coloca no lugar dela (mantém a posição para a lista não "pular").
 */
export function applyFeedback(suggestions: Suggestion[], titleId: string, next: Suggestion | null): Suggestion[] {
  const index = suggestions.findIndex((s) => s.title.id === titleId);
  if (index < 0) return suggestions;
  const rest = suggestions.filter((s) => s.title.id !== titleId);
  if (!next || rest.some((s) => s.title.id === next.title.id)) return rest;
  return [...rest.slice(0, index), next, ...rest.slice(index)];
}

/** Move o item `index` uma posição para cima (-1) ou para baixo (+1); fora dos limites, devolve igual. */
export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const out = [...items];
  [out[index], out[target]] = [out[target] as T, out[index] as T];
  return out;
}

/** Progresso da lista: "2/5" e fração 0..1 para a barra. */
export function progressOf(done: number, total: number): { label: string; ratio: number } {
  const safeTotal = Math.max(total, 1);
  const clamped = Math.min(Math.max(done, 0), safeTotal);
  return { label: `${clamped}/${safeTotal}`, ratio: clamped / safeTotal };
}

/**
 * Opções de gênero para edição manual: sem endpoint de taxonomia no contrato, junta os gêneros que
 * aparecem nos títulos do usuário (key + label), sem repetir, em ordem alfabética do rótulo.
 */
export function collectGenreOptions(titles: readonly Pick<Title, 'genres'>[], extra: readonly TaxonomyTag[] = []): TaxonomyTag[] {
  const byKey = new Map<string, TaxonomyTag>();
  for (const tag of [...extra, ...titles.flatMap((t) => t.genres)]) {
    if (!byKey.has(tag.key)) byKey.set(tag.key, tag);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/** Alterna um gênero na seleção (máximo 6, limite do UpdateTitleRequest). */
export function toggleGenre(selected: readonly string[], key: string, max = 6): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  return selected.length >= max ? [...selected] : [...selected, key];
}
