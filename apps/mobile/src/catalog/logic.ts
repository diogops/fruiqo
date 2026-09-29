// Lógica pura do catálogo no app (mesmos ajustes do web): filtros, chips de gênero, reordenação
// otimista da fila, rascunho de prioridade e preparo do .txt (RF-47). Sem React/rede: testável.
import { type BookSearchResult, type CreateFavoriteRequest, type CreateShareRequest, MAX_TEXT_FILE_CHARS, type MoveTitleRequest, type Title } from '@fruiqo/contracts';

// ---------- Filtros (RF-24) ----------

export type CatalogFilters = {
  q?: string;
  kind?: string;
  status?: Title['status'];
  genre?: string;
  listId?: string;
};

/** Query de GET /library; o ranking/filtragem é da API (RF-30), o app só monta a query. */
export function buildLibraryQuery(f: CatalogFilters, cursor?: string | null): Record<string, string | undefined> {
  return {
    q: f.q?.trim() || undefined,
    kind: f.kind,
    status: f.status,
    genre: f.genre,
    listId: f.listId,
    sort: 'rank',
    limit: '50',
    cursor: cursor ?? undefined,
  };
}

/** Contador do botão "Filtros" (a busca por texto fica fora: tem campo próprio). */
export function activeFilterCount(f: CatalogFilters): number {
  return [f.kind, f.status, f.genre, f.listId].filter(Boolean).length;
}

/** Até `max` gêneros visíveis + quantos sobraram ("+N"). */
export function genreChips(genres: { key: string; label: string }[], max = 2) {
  return { shown: genres.slice(0, max), extra: Math.max(0, genres.length - max) };
}

// ---------- Fila por posição (reordenação otimista) ----------

type Ranked = { id: string; rank: number | null };

/**
 * Aplica um movimento na lista carregada (ordenada por rank) e renumera as posições visíveis,
 * para a tela reagir antes da resposta da API. Com a lista parcial (paginada), "fim" e
 * "posição além do carregado" levam o item para o fim do que está carregado; a API é a fonte
 * da verdade e a tela recarrega depois.
 */
export function moveLocal<T extends Ranked>(items: T[], id: string, req: MoveTitleRequest): T[] {
  const from = items.findIndex((t) => t.id === id);
  if (from < 0) return items;
  let to: number;
  if ('position' in req) to = Math.min(Math.max(req.position - 1, 0), items.length - 1);
  else if (req.to === 'top') to = 0;
  else if (req.to === 'bottom') to = items.length - 1;
  else if (req.to === 'up') to = Math.max(from - 1, 0);
  else to = Math.min(from + 1, items.length - 1);
  if (to === from) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const base = Math.min(...items.map((t) => t.rank ?? Number.POSITIVE_INFINITY));
  const start = Number.isFinite(base) ? base : 1;
  return next.map((t, i) => (t.rank == null ? t : { ...t, rank: start + i }));
}

/** "Suba 3" / "Desça 2" / "Mantém" para o rascunho (delta positivo = sobe). */
export function deltaLabel(delta: number): string {
  if (delta > 0) return `▲ ${delta}`;
  if (delta < 0) return `▼ ${-delta}`;
  return '=';
}

// ---------- Seleção múltipla ----------

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// ---------- Import de .txt (RF-47) ----------

export type PickedFile = { name?: string | null; mimeType?: string | null; uri: string };

export function isTextFile(f: PickedFile): boolean {
  const mime = f.mimeType?.toLowerCase() ?? '';
  return mime.startsWith('text/plain') || /\.txt$/i.test(f.name ?? '');
}

export function isImageFile(f: PickedFile): boolean {
  return (f.mimeType?.toLowerCase() ?? '').startsWith('image/');
}

export type TextFileBuild =
  | { kind: 'ok'; request: CreateShareRequest; truncated: boolean }
  | { kind: 'empty' };

/**
 * Monta o CreateShareRequest de um .txt: normaliza quebras (CRLF/CR → LF), tira BOM e espaços nas
 * pontas, e corta no limite do contrato. O parser de títulos é da API.
 */
export function buildTextFileRequest(name: string, raw: string, newId: () => string): TextFileBuild {
  const content = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) return { kind: 'empty' };
  const truncated = content.length > MAX_TEXT_FILE_CHARS;
  const cut = truncated ? content.slice(0, MAX_TEXT_FILE_CHARS) : content;
  const safeName = (name.trim() || 'lista.txt').slice(0, 200);
  return { kind: 'ok', truncated, request: { clientShareId: newId(), textFile: { name: safeName, content: cut } } };
}

// ---------- Revisão (RF-42) ----------

/** "Entra como #4 de 46" */
export function fitLabel(fit: { position: number; total: number } | null | undefined): string | null {
  return fit ? `Entra como #${fit.position} de ${fit.total}` : null;
}

const MUSIC_KINDS = new Set<string>(['music_track', 'music_album', 'artist']);

/** "Trocar música/artista" só faz sentido em item de música que tenha artista. */
export function canSwapMusic(t: Pick<Title, 'kind' | 'creator'>): boolean {
  return MUSIC_KINDS.has(t.kind) && !!t.creator;
}

/** Aderência do match em %, só quando o pipeline informou. */
export function matchPercent(score: number | undefined): string | null {
  return score === undefined ? null : `${Math.round(score * 100)}%`;
}

// ---------- Adicionar título (RF-46/RF-48) ----------

/** Chave de seleção estável para resultados de filme/série e de livro. */
export const movieKey = (m: { tmdbId: number; mediaType: 'movie' | 'tv' }) => `tmdb:${m.mediaType}:${m.tmdbId}`;
export const bookKey = (b: { olWorkId: string }) => `ol:${b.olWorkId}`;

/** Separa as chaves escolhidas no formato de POST /library/import. */
export function splitSelection(keys: string[]) {
  const items: { tmdbId: number; mediaType: 'movie' | 'tv' }[] = [];
  const books: { olWorkId: string }[] = [];
  for (const k of keys) {
    const [src, a, b] = k.split(':');
    if (src === 'tmdb' && (a === 'movie' || a === 'tv') && Number.isInteger(Number(b))) items.push({ tmdbId: Number(b), mediaType: a });
    else if (src === 'ol' && a) books.push({ olWorkId: k.slice(3) });
  }
  return { items, books };
}

// ---------- Perfil declarado (RF-43/RF-48) ----------

/**
 * Favorito de livro pela busca: leva a obra da Open Library (o servidor busca capa e gêneros).
 * Ano antes de 1870 fica fora do contrato; nesse caso o servidor usa o da Open Library.
 */
export function bookFavoriteRequest(b: Pick<BookSearchResult, 'title' | 'year' | 'olWorkId'>): CreateFavoriteRequest {
  return { title: b.title, kind: 'book', ...(b.year !== undefined && b.year >= 1870 ? { year: b.year } : {}), olWorkId: b.olWorkId };
}
