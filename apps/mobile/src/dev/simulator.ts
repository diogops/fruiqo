// Simulador de share (RF-18): converte cada tipo de entrada no MESMO formato que o expo-share-intent entrega
// (IncomingShare), para que tudo siga por receiveShare como um share real. Sem módulos nativos aqui.
import type { IncomingShare } from '../share/buildShareRequest';
import type { RecognizeFn } from '../share/ingestImages';
import type { IncomingFile } from '../share/screenshotPages';
import type { SimFixture } from './fixtureIndex.generated';

/** URL: no Android o share de um link chega com o link em `text` e em `webUrl` (device-tests-log A-03/A-09). */
export const urlToIncoming = (url: string): IncomingShare => ({ text: url.trim(), webUrl: url.trim(), files: null });

export const textToIncoming = (text: string): IncomingShare => ({ text, webUrl: null, files: null });

export const imagesToIncoming = (files: IncomingFile[]): IncomingShare => ({ text: null, webUrl: null, files });

const FIXTURE_SCHEME = 'fixture://';

/** Prints de uma fixture viram "arquivos" fictícios; o OCR vem do texto versionado da fixture. */
export function fixtureToIncoming(fixture: SimFixture): IncomingShare {
  if (fixture.kind === 'url' && fixture.url) return urlToIncoming(fixture.url);
  if (fixture.kind === 'text' && fixture.text) return textToIncoming(fixture.text);
  const pages = fixture.pages ?? [];
  return imagesToIncoming(
    pages.map((_, i) => ({ path: `${FIXTURE_SCHEME}${fixture.id}/page-${i + 1}`, mimeType: 'image/png' })),
  );
}

/**
 * OCR simulado: devolve, para cada imagem, o texto de OCR versionado da página na MESMA posição.
 * As URIs chegam na ordem da seleção (selectImages preserva a ordem), inclusive no navegador,
 * onde os arquivos escolhidos no input são associados às páginas da fixture pela posição.
 */
export function fixtureRecognizer(fixture: SimFixture): RecognizeFn {
  const pages = fixture.pages ?? [];
  return async (uris, onProgress) =>
    uris.map((_, i) => {
      onProgress?.({ current: i + 1, total: uris.length });
      const text = pages[i];
      return text ? [text] : null;
    });
}
