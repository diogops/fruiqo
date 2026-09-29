import { createHash } from 'node:crypto';
import type { RecommendationKind } from '@fruiqo/contracts';

/**
 * Normalização usada na deduplicação de prints e de itens.
 *
 * Escolhas:
 * - NFKC primeiro: junta formas de compatibilidade (ex.: letras "fancy" de legenda, dígitos de largura
 *   total) antes de comparar.
 * - Acentos removidos (NFD + descarte de marcas combinantes): OCR costuma perder/trocar acentos entre
 *   dois prints do mesmo texto. Isso também transforma o emoji "1️⃣" em "1".
 * - Minúsculas e espaços colapsados; linhas vazias descartadas.
 */
export function normalizeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l.length > 0)
    .join('\n');
}

export function normalizeLine(line: string): string {
  return line
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\p{M}\u{FE0F}]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash de um print: calculado no servidor, nunca aceito do cliente. */
export function pageHash(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

// "1.", "1)", "01 -", "#1", "1º", "10:" no início; bullets comuns de legenda. Número seguido só de
// espaço NÃO é removido aqui ("2 Fast 2 Furious", "300"): o extrator de listas já tira esses marcadores.
const LEADING_MARKER = /^\s*(?:#\s*\d{1,3}\s*[.)º°ª:\-–—]?|\d{1,3}\s*[.)º°ª:\-–—])\s*|^\s*[•▪►▶●◦*·\-–—]\s*/u;
const YEAR_IN_PARENS = /\((?:19|20)\d{2}\)/g;
const NOT_ALNUM = /[^\p{L}\p{N} ]/gu;

/**
 * Título/criador para comparação: normalizado, sem marcador de lista, sem "(2019)", sem pontuação.
 * Mantém letras de qualquer alfabeto (\p{L}) para não zerar títulos não latinos.
 */
export function normalizeForKey(value: string): string {
  const base = normalizeLine(value).replace(LEADING_MARKER, '');
  const key = base.replace(YEAR_IN_PARENS, ' ').replace(NOT_ALNUM, ' ').replace(/\s+/g, ' ').trim();
  return key || base;
}

/**
 * Grupo de tipo na chave:
 * - `screen`: filme e série juntos (um mesmo título costuma ser classificado dos dois jeitos por heurística);
 * - `music`: faixa, álbum e artista (o criador entra na chave);
 * - `other`: sem classificação.
 */
export function kindGroup(kind: RecommendationKind): 'screen' | 'music' | 'book' | 'other' {
  if (kind === 'movie' || kind === 'series') return 'screen';
  // RF-48: livro tem grupo próprio (a adaptação para filme não é o mesmo item)
  if (kind === 'book') return 'book';
  if (kind === 'music_track' || kind === 'music_album' || kind === 'artist') return 'music';
  return 'other';
}

/** Chave única por usuário (índice recommendations_user_dedup_key). */
export function dedupKey(item: { kind: RecommendationKind; title: string; creator?: string | null }): string {
  const group = kindGroup(item.kind);
  const title = normalizeForKey(item.title);
  // Em filme/série o criador raramente aparece e varia (diretor, estúdio): fica fora da chave.
  const creator = group === 'music' && item.creator ? normalizeForKey(item.creator) : '';
  return creator ? `${group}:${title}|${creator}` : `${group}:${title}`;
}

/**
 * Junta os prints na ordem recebida descartando linhas repetidas pela sobreposição da rolagem
 * (a mesma linha normalizada já vista neste share). Preserva o texto original da primeira ocorrência.
 */
export function mergePages(pages: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const page of pages) {
    for (const raw of page.split(/\r?\n/)) {
      const key = normalizeLine(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(raw.trim());
    }
  }
  return out.join('\n');
}
