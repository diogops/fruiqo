// Converte o payload do expo-share-intent no CreateShareRequest do contrato.
// Função pura (sem módulos nativos) para poder ser testada isoladamente.
import { type CreateShareRequest, CreateShareRequestSchema } from '@fruiqo/contracts';

export type IncomingShare = {
  text?: string | null;
  webUrl?: string | null;
  files?: unknown[] | null;
};

export type BuildResult =
  | { kind: 'ok'; request: CreateShareRequest }
  | { kind: 'unsupported'; reason: 'files' | 'empty' };

const MAX_TEXT = 5000;

function httpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function buildShareRequest(incoming: IncomingShare, clientShareId: string): BuildResult {
  const text = incoming.text?.trim() ? incoming.text.trim().slice(0, MAX_TEXT) : undefined;
  const url = httpsUrl(incoming.webUrl);

  if (!text && !url) {
    // Imagens são tratadas antes (OCR no device, screenshotPages.ts); aqui sobram PDF/outros arquivos.
    return { kind: 'unsupported', reason: incoming.files?.length ? 'files' : 'empty' };
  }

  const parsed = CreateShareRequestSchema.safeParse({ clientShareId, text, url });
  if (!parsed.success) {
    // URL fora do contrato (ex.: longa demais): manda só o texto.
    const fallback = CreateShareRequestSchema.safeParse({ clientShareId, text: text ?? url });
    return fallback.success ? { kind: 'ok', request: fallback.data } : { kind: 'unsupported', reason: 'empty' };
  }
  return { kind: 'ok', request: parsed.data };
}
