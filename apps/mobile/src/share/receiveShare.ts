// Ponto de entrada ÚNICO do conteúdo compartilhado (RF-18): o share sheet real (ShareIntentHandler) e o
// simulador de dev (/dev/share) passam por aqui. Função pura: OCR e gerador de id são injetados, o que
// permite provar em teste que os dois caminhos produzem o mesmo CreateShareRequest.
import type { CreateShareRequest } from '@fruiqo/contracts';

import { buildShareRequest, type IncomingShare } from './buildShareRequest';
import { ingestImages, type RecognizeFn } from './ingestImages';
import type { OcrProgress } from './ocr';
import { selectImages } from './screenshotPages';

export type ReceiveDeps = {
  recognize: RecognizeFn;
  ocrSupported: boolean;
  newId: () => string;
  onProgress?: (p: OcrProgress) => void;
};

export type ReceiveResult =
  | { kind: 'ok'; request: CreateShareRequest; truncated: boolean; ignoredOtherFiles: boolean }
  | { kind: 'unsupported'; reason: 'files' | 'empty' }
  | { kind: 'no_text' }
  | { kind: 'ocr_unavailable' };

export async function receiveShare(incoming: IncomingShare, deps: ReceiveDeps): Promise<ReceiveResult> {
  // Imagens têm prioridade (mesma regra do share real): viram páginas de OCR e o texto do share é ignorado.
  const images = selectImages(incoming.files);
  if (images) {
    if (!deps.ocrSupported) return { kind: 'ocr_unavailable' };
    const built = await ingestImages(images, deps);
    if (built.kind === 'empty') return { kind: 'no_text' };
    return {
      kind: 'ok',
      request: built.request,
      truncated: images.truncated,
      ignoredOtherFiles: images.ignoredOtherFiles,
    };
  }
  const result = buildShareRequest(incoming, deps.newId());
  return result.kind === 'ok'
    ? { kind: 'ok', request: result.request, truncated: false, ignoredOtherFiles: false }
    : result;
}
