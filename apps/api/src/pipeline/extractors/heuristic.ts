import { extractListItems, extractTextFileItems } from './list.js';
import type { ExtractedItem, ExtractionInput, Extractor } from './types.js';

// Sufixos típicos de título de vídeo que não fazem parte do nome da obra.
const NOISE =
  /\s*[([](official\s*(music\s*)?(video|audio|lyric video|visualizer)|lyrics?|letra|legendado|clipe oficial|v[ií]deo oficial|audio|hd|4k|live[^)\]]*|ao vivo[^)\]]*)[)\]]\s*/gi;
const TRAILER = /\s*[-|–:]\s*(official\s+)?(trailer|teaser)(\s+(oficial|\d+|#\d+))*.*$/i;
const TRAILER_PT = /\s*[-|–:]?\s*trailers?\s+(oficial|legendado|dublado).*$/i;
const SERIES_HINT = /\b(season|temporada|s\d{1,2}\b|série|series)\b/i;
const YEAR = /\((19|20)\d{2}\)/;

function clean(s: string): string {
  return s.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Extração sem rede e sem LLM (padrão da D-04). Olha título/autor do oEmbed ou, sem ele,
 * procura itens de lista no texto compartilhado/OCR (extractors/list.ts). Resultados de baixa confiança: servem de ponto de partida, não de verdade.
 */
export class HeuristicExtractor implements Extractor {
  readonly name = 'heuristic' as const;

  async extract(input: ExtractionInput): Promise<ExtractedItem[]> {
    // RF-47: .txt importado, um título por linha
    if (input.origin === 'text_file') return input.text ? extractTextFileItems(input.text, input.fileName) : [];

    const title = input.title?.trim();
    if (title) return [this.fromTitle(title)];

    // legenda colada ou OCR de prints: procura itens de lista
    if (input.text) {
      const listed = extractListItems(input.text);
      if (listed.length > 0 || input.origin === 'screenshot') return listed;
    }

    const firstLine = input.text
      ?.split(/\r?\n/)
      .map((l) => l.replace(/https:\/\/\S+/g, '').trim())
      .find((l) => l.length >= 3);
    if (!firstLine) return [];
    return [{ kind: 'other', title: firstLine.slice(0, 200), confidence: 0.1 }];
  }

  private fromTitle(raw: string): ExtractedItem {
    const yearMatch = YEAR.exec(raw);
    const year = yearMatch ? Number(yearMatch[0].slice(1, 5)) : undefined;

    if (TRAILER.test(raw) || TRAILER_PT.test(raw)) {
      const name = clean(raw.replace(TRAILER, '').replace(TRAILER_PT, '').replace(YEAR, ''));
      return {
        kind: SERIES_HINT.test(raw) ? 'series' : 'movie',
        title: name.slice(0, 200) || raw.slice(0, 200),
        ...(year ? { year } : {}),
        confidence: 0.6,
      };
    }

    // "Artista - Música", o formato mais comum de vídeo musical
    const parts = raw.split(/\s+[-–—]\s+/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      const creator = clean(parts[0]);
      const song = clean(parts[1].split(/\s*[|/]\s*/)[0] ?? parts[1]);
      if (creator && song) {
        return { kind: 'music_track', title: song.slice(0, 200), creator: creator.slice(0, 200), confidence: 0.5 };
      }
    }

    return { kind: 'other', title: clean(raw).slice(0, 200) || raw.slice(0, 200), confidence: 0.2 };
  }
}
