// Prints de tela: seleção das imagens do share e montagem das páginas de texto (resultado do OCR).
// Funções puras (sem módulos nativos) para poder testar isoladamente. O OCR roda no device
// (TOS-REQ-21): só o texto de cada print vai para a API, a imagem nunca sai do aparelho.
import { type CreateShareRequest, CreateShareRequestSchema, MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';

/** Limite do contrato por página (CreateShareRequest.pages[i]). */
export const MAX_PAGE_CHARS = 8000;

export type IncomingFile = {
  path?: string | null;
  mimeType?: string | null;
};

export type ImageSelection = {
  /** URIs prontas para o OCR, na ordem recebida */
  uris: string[];
  /** true se vieram mais imagens que o limite e o excedente foi descartado */
  truncated: boolean;
  /** true se, além das imagens, vieram arquivos que não são imagem (ex.: PDF), ignorados */
  ignoredOtherFiles: boolean;
};

/** Converte o `path` entregue pelo expo-share-intent numa URI que o OCR aceita. */
export function toOcrUri(path: string): string {
  const p = path.trim();
  if (/^(file|content):\/\//i.test(p)) return p;
  return p.startsWith('/') ? `file://${p}` : `file:///${p}`;
}

function isImage(file: IncomingFile): boolean {
  return typeof file.mimeType === 'string' && file.mimeType.toLowerCase().startsWith('image/');
}

/** Seleciona as imagens do share (até o limite do contrato). `null` quando não há imagem. */
export function selectImages(files: readonly unknown[] | null | undefined): ImageSelection | null {
  if (!files?.length) return null;
  const all = files.filter((f): f is IncomingFile => typeof f === 'object' && f !== null);
  const images = all.filter((f) => isImage(f) && typeof f.path === 'string' && f.path.trim() !== '');
  if (images.length === 0) return null;
  return {
    uris: images.slice(0, MAX_SCREENSHOT_PAGES).map((f) => toOcrUri(f.path as string)),
    truncated: images.length > MAX_SCREENSHOT_PAGES,
    ignoredOtherFiles: images.length < all.length,
  };
}

/**
 * Junta o resultado do OCR de uma imagem (blocos/linhas) num texto de página:
 * apara cada linha, remove linhas vazias e espaços repetidos, corta no limite do contrato.
 * Retorna `null` se não sobrou texto.
 */
export function buildPage(ocr: readonly string[] | null | undefined): string | null {
  if (!ocr?.length) return null;
  const lines = ocr
    .join('\n')
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const text = lines.join('\n').slice(0, MAX_PAGE_CHARS).trim();
  return text.length > 0 ? text : null;
}

/** Monta as páginas a partir dos resultados de OCR (null = OCR falhou nessa imagem), na mesma ordem. */
export function buildPages(results: readonly (readonly string[] | null | undefined)[]): string[] {
  return results
    .map(buildPage)
    .filter((p): p is string => p !== null)
    .slice(0, MAX_SCREENSHOT_PAGES);
}

export type ScreenshotBuildResult =
  | { kind: 'ok'; request: CreateShareRequest }
  | { kind: 'empty' };

/** CreateShareRequest só com `pages` (sem url/text: as imagens têm prioridade). */
export function buildScreenshotRequest(pages: readonly string[], clientShareId: string): ScreenshotBuildResult {
  if (pages.length === 0) return { kind: 'empty' };
  const parsed = CreateShareRequestSchema.safeParse({ clientShareId, pages: [...pages] });
  return parsed.success ? { kind: 'ok', request: parsed.data } : { kind: 'empty' };
}
