// Ingestão de imagens (prints): o MESMO caminho para o share sheet e para o "Importar prints" (RF-40).
// Seleção → OCR no device → páginas → CreateShareRequest. Sem módulos nativos aqui: o OCR é injetado,
// o que permite testar os dois pontos de entrada com o mesmo OCR simulado.
import type { OcrProgress } from './ocr';
import {
  buildPages,
  buildScreenshotRequest,
  selectImages,
  type ImageSelection,
  type IncomingFile,
  type ScreenshotBuildResult,
} from './screenshotPages';

export type RecognizeFn = (
  uris: readonly string[],
  onProgress?: (p: OcrProgress) => void,
) => Promise<(string[] | null)[]>;

export async function ingestImages(
  selection: ImageSelection,
  deps: { recognize: RecognizeFn; newId: () => string; onProgress?: (p: OcrProgress) => void },
): Promise<ScreenshotBuildResult> {
  const results = await deps.recognize(selection.uris, deps.onProgress);
  return buildScreenshotRequest(buildPages(results), deps.newId());
}

/** Asset devolvido pelo expo-image-picker ou pelo expo-document-picker. */
export type PickerAsset = {
  uri: string;
  mimeType?: string | null;
  /** expo-image-picker: 'image' | 'video' | ... (o mimeType pode vir vazio em alguns aparelhos) */
  type?: string | null;
};

/** Converte os assets dos seletores no formato do share, para passar pelo mesmo `selectImages`. */
export function pickerAssetsToFiles(assets: readonly PickerAsset[]): IncomingFile[] {
  return assets.map((a) => ({
    path: a.uri,
    mimeType: a.mimeType ?? (a.type === 'image' ? 'image/*' : null),
  }));
}

/** Seleção de imagens a partir dos assets dos seletores (mesmas regras do share: ordem, limite, só imagem). */
export function selectPickedImages(assets: readonly PickerAsset[]): ImageSelection | null {
  return selectImages(pickerAssetsToFiles(assets));
}
