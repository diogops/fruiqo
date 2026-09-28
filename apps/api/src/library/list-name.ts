import { normalizeForKey } from '../pipeline/dedup.js';
import { isUiNoise } from '../pipeline/ui-noise.js';

const ITEM_MARKER = /^\s*(?:#\s*\d{1,3}|\d{1,3}\s*[.)º°:\-–—]|[•▪▶●◦*·\-–—]\s)/u;
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu;
const MAX_NAME = 80;

/**
 * Nome da lista gerada a partir de um share de prints: a primeira linha "de cabeçalho" antes do
 * primeiro item (ex.: "12 filmes que você PRECISA ver"), sem ruído de UI e sem emoji. Sem cabeçalho
 * reconhecível → "Prints de <data>".
 */
export function listNameFromOcr(text: string, itemTitles: string[], now: Date): string {
  const titles = itemTitles.map((t) => normalizeForKey(t)).filter(Boolean);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || isUiNoise(line)) continue;
    if (ITEM_MARKER.test(line)) break; // o cabeçalho vem antes do primeiro item
    const norm = normalizeForKey(line);
    if (titles.some((t) => norm.includes(t))) break;
    const letters = line.match(/\p{L}/gu)?.length ?? 0;
    const words = line.split(/\s+/).length;
    if (letters < 6 || words < 3 || line.length > 120) continue; // @handles, legendas soltas, parágrafos
    const clean = line.replace(PICTOGRAPHS, '').replace(/\s*:\s*$/, '').replace(/\s+/g, ' ').trim();
    if (clean.length >= 6) return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME - 1).trimEnd()}…` : clean;
  }
  const date = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `Prints de ${date}`;
}
