// OCR no device (ML Kit no Android, Apple Vision no iOS) via expo-text-extractor.
// A imagem é lida localmente; nada é enviado para fora do aparelho aqui.
import { extractTextFromImage, isSupported } from 'expo-text-extractor';

export const ocrSupported: boolean = isSupported;

export type OcrProgress = { current: number; total: number };

/**
 * Roda o OCR em cada imagem, em sequência (uma por vez, para não pressionar memória).
 * Falha numa imagem vira `null` e não interrompe as demais.
 */
export async function recognizeAll(
  uris: readonly string[],
  onProgress?: (p: OcrProgress) => void,
): Promise<(string[] | null)[]> {
  const results: (string[] | null)[] = [];
  for (let i = 0; i < uris.length; i++) {
    onProgress?.({ current: i + 1, total: uris.length });
    try {
      results.push(await extractTextFromImage(uris[i]));
    } catch {
      results.push(null);
    }
  }
  return results;
}
