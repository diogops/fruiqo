import type { LlmExtraction, Platform } from '@fruiqo/contracts';

export interface ExtractionInput {
  userId: string;
  platform: Platform;
  /** 'screenshot': `text` é o OCR dos prints já mesclado; sem fallback de "primeira linha" */
  origin?: 'link' | 'screenshot';
  text?: string;
  title?: string;
  author?: string;
}

export type ExtractedItem = LlmExtraction['items'][number];

export interface Extractor {
  readonly name: 'llm' | 'heuristic';
  extract(input: ExtractionInput): Promise<ExtractedItem[]>;
}
