// Texto lido dos prints à espera da conferência na tela "Conferir títulos". Só em memória: o texto
// de terceiros não vai para disco nem para a API antes de o usuário confirmar os títulos.
import type { OcrLine } from '@fruiqo/contracts';

export interface ImportDraft {
  lines: OcrLine[];
  fullText: string;
  prints: number;
}

let draft: ImportDraft | null = null;

/**
 * Linhas do OCR de cada print, na ordem. O ML Kit/Vision não informa confiança por linha: todas
 * entram com confiança alta, e a pré-seleção vem das pistas de lista (número, ano, marcador).
 */
export function draftFromOcr(results: readonly (string[] | null)[]): ImportDraft | null {
  const texts = results.filter((r): r is string[] => Array.isArray(r) && r.length > 0);
  const lines = texts.flatMap((t) => t.map((text) => ({ text, confidence: 90 })));
  if (lines.every((l) => !l.text.trim())) return null;
  return { lines, fullText: texts.map((t) => t.join('\n')).join('\n\n'), prints: texts.length };
}

export function setImportDraft(d: ImportDraft): void {
  draft = d;
}

/** Entrega o rascunho uma vez só (a tela é a única dona dele). */
export function takeImportDraft(): ImportDraft | null {
  const d = draft;
  draft = null;
  return d;
}
