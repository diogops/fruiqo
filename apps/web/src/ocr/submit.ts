// Cadastro dos títulos confirmados pelo fluxo que já existe: um .txt com cabeçalho por categoria vai
// em `POST /shares` (`textFile`, RF-47). O backend valida o texto, aplica a política de duplicidade
// (dedup_key por usuário) e manda cada item para a Revisão, onde a obra certa é confirmada no TMDB
// ou na Open Library (RF-42). Nenhum endpoint novo: o resultado por item vem de `/shares/:id/steps`.
import type { CandidateDecision, CreateShareRequest } from '@fruiqo/contracts';
import { candidateKey, normalizeSpaces, type CandidateKind } from './candidates';

export const IMPORT_FILE_NAME = 'Importado de imagem.txt';
/** limite do contrato por título na importação */
const MAX_TITLE_CHARS = 200;

const HEADERS: Record<CandidateKind, string> = { movie: 'Filmes:', series: 'Séries:', book: 'Livros:' };
const ORDER: CandidateKind[] = ['movie', 'series', 'book'];

export interface ConfirmedItem {
  id: string;
  text: string;
  kind: CandidateKind;
}

/** Título pronto para a linha do .txt: uma linha só, sem ":" no fim (viraria cabeçalho). */
export function sanitizeTitle(text: string): string {
  return normalizeSpaces(text).replace(/:+\s*$/, '').slice(0, MAX_TITLE_CHARS).trim();
}

/** Conteúdo do .txt: um bloco por categoria, na ordem filmes → séries → livros. */
export function buildImportText(items: readonly ConfirmedItem[]): string {
  const blocks: string[] = [];
  for (const kind of ORDER) {
    const lines = items.filter((i) => i.kind === kind).map((i) => sanitizeTitle(i.text)).filter(Boolean);
    if (lines.length > 0) blocks.push([HEADERS[kind], ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

export function buildImportRequest(items: readonly ConfirmedItem[], clientShareId: string): CreateShareRequest {
  return { clientShareId, textFile: { name: IMPORT_FILE_NAME, content: buildImportText(items) } };
}

export type ItemOutcome = 'review' | 'duplicate' | 'failed';

export interface ItemResult {
  item: ConfirmedItem;
  outcome: ItemOutcome;
}

const KIND_OF: Record<CandidateKind, string[]> = { movie: ['movie'], series: ['series'], book: ['book'] };

/** chave do título como o pipeline guarda (`rawTitle` vem sem o ano entre parênteses) */
function titleKey(text: string): string {
  return candidateKey(sanitizeTitle(text).replace(/\((?:18|19|20)\d{2}\)/g, ' '));
}

/**
 * Resultado por item, cruzando com as decisões do pipeline (`rawTitle` + tipo). `review` = entrou na
 * Revisão; `duplicate` = já estava na lista do usuário; `failed` = não virou item (descartado ou não
 * reconhecido): esses podem ser corrigidos e enviados de novo.
 */
export function matchOutcomes(items: readonly ConfirmedItem[], decisions: readonly CandidateDecision[]): ItemResult[] {
  const pool = decisions.map((d) => ({ d, key: candidateKey(d.rawTitle), used: false }));
  return items.map((item) => {
    const key = titleKey(item.text);
    const hit =
      pool.find((p) => !p.used && p.key === key && KIND_OF[item.kind].includes(p.d.kind)) ??
      pool.find((p) => !p.used && p.key === key) ??
      pool.find((p) => !p.used && key.length >= 4 && (p.key.includes(key) || key.includes(p.key)) && p.key.length >= 4);
    if (!hit) return { item, outcome: 'failed' as const };
    hit.used = true;
    // importações (RF-42) gravam o motivo com a sugestão na frente: "suggested_cataloged:already_in_list"
    if (hit.d.reason.split(':').includes('already_in_list')) return { item, outcome: 'duplicate' as const };
    return { item, outcome: hit.d.decision === 'discarded' ? ('failed' as const) : ('review' as const) };
  });
}
