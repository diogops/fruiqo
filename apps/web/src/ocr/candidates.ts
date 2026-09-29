// Candidatos a título a partir das linhas do OCR. Heurísticas conservadoras e pequenas: o OCR lê
// texto, não sabe o que é obra. Nada é inventado: cada candidato é uma linha lida (limpa de marcador
// de lista); a categoria fica sempre para o usuário escolher. As listas abaixo são os pontos de ajuste.
import type { OcrLine } from './engine';

export type CandidateKind = 'movie' | 'series' | 'book';

export interface Candidate {
  id: string;
  /** texto exibido e editável */
  text: string;
  selected: boolean;
  /** null até o usuário escolher */
  kind: CandidateKind | null;
  /** leitura de baixa confiança: só um aviso para conferir a grafia */
  uncertain: boolean;
  /** na lista principal; as outras linhas lidas ficam recolhidas para quando faltar algum título */
  visible: boolean;
  source: 'ocr' | 'manual';
}

/** Abaixo disso a leitura dos caracteres é duvidosa (aviso "confira"); não decide se é título. */
export const UNCERTAIN_BELOW = 60;

/** Palavras/frases de interface (comparadas com a linha inteira, sem acento e em minúsculas). */
const UI_PHRASES = new Set([
  'seguir',
  'seguindo',
  'follow',
  'following',
  'mensagem',
  'message',
  'curtir',
  'like',
  'responder',
  'reply',
  'compartilhar',
  'share',
  'enviar',
  'send',
  'salvar',
  'save',
  'mais',
  'more',
  'ver mais',
  'see more',
  'ver traducao',
  'see translation',
  'ocultar',
  'hide',
  'patrocinado',
  'sponsored',
  'ver todos os comentarios',
  'view all comments',
  'adicione um comentario',
  'add a comment',
  'o que voce acha disso?',
  'o que voce acha disso',
  'responder a',
  'original audio',
  'audio original',
  'inscrever-se',
  'subscribe',
  'inscrito',
  'subscribed',
  'para voce',
  'for you',
]);

const UI_PATTERNS: RegExp[] = [
  // horário da barra de status: "12:57", "9:41", e com os ícones de sinal/bateria lidos como lixo ("12:57 nw te)")
  /^\d{1,2}[:h]\d{2}$/i,
  /^\d{1,2}:\d{2}(\s+\S{1,4}){1,3}$/,
  // tempo relativo: "Há 21 horas", "21 h", "2 sem", "3d", "5 min atrás"
  /^(ha\s+)?\d+\s*(s|seg|min|minutos?|h|horas?|d|dias?|sem|semanas?|m|meses?|a|anos?|w|wk|weeks?|days?|hours?|mins?)(\s+atras|\s+ago)?$/i,
  // contadores: "1.234 curtidas", "12 mil visualizações", "305 comments"
  /^[\d.,]+\s*(mil|k|mi|m)?\s*(curtidas?|likes?|comentarios?|comments?|visualizacoes|views|seguidores|followers|respostas|replies)$/i,
  // @perfil, #hashtag e links soltos
  /^@[\w.]+$/,
  /^(#[\p{L}\p{N}_]+\s*)+$/u,
  /^(https?:\/\/|www\.)\S+$/i,
];

/** Marcador de lista no começo: "1.", "2)", "#3", "•", "-", emojis/sinais que o OCR leu como símbolo. */
const LEADING_SYMBOLS = /^[^\p{L}\p{N}"'“‘(¿¡]+/u;
const NUMBER_MARKER = /^#?\d{1,3}\s*[.)]\s+(?=\S)/;

/** Espaços normalizados. */
export function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Chave de comparação: minúsculas, sem acento e sem pontuação (só para achar repetidos). */
export function candidateKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** marcadores clássicos de lista; outros símbolos no começo (emoji lido como "»", "&"…) só são removidos */
const BULLETS = /^[•·▪●◦*\-–—]\s*$/u;

/**
 * Remove o marcador de lista do começo. `marked` = número ("1.", "2)") ou bullet clássico ("•", "-");
 * símbolo solto (um emoji como 👉 que o OCR leu como sinal) é tirado mas não conta como lista.
 * "1984", "Up" e "2001: Uma Odisseia" continuam intactos.
 */
export function stripListMarker(s: string): { text: string; marked: boolean } {
  let text = normalizeSpaces(s);
  let marked = false;
  const sym = LEADING_SYMBOLS.exec(text);
  if (sym) {
    text = text.slice(sym[0].length);
    marked = BULLETS.test(sym[0]);
  }
  const num = NUMBER_MARKER.exec(text);
  if (num) {
    text = text.slice(num[0].length);
    marked = true;
  }
  return { text: text.trim(), marked };
}

/** Elemento de interface (horário, botão, contador, @perfil…) ou linha sem letra/dígito. */
export function isUiNoise(text: string): boolean {
  const key = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!/[\p{L}\p{N}]/u.test(key)) return true;
  if (UI_PHRASES.has(key)) return true;
  return UI_PATTERNS.some((re) => re.test(key));
}

/** Lixo de leitura: menos da metade dos caracteres são letras/dígitos ("| ¥", "Ph | FP as |"). */
export function isGarbled(text: string): boolean {
  const chars = text.replace(/\s/g, '');
  if (chars.length === 0) return true;
  // artefatos típicos do OCR (bordas, ícones), raros em título
  if (/[|¦¥¤§]/u.test(chars)) return true;
  const alnum = (chars.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return alnum / chars.length < 0.5;
}

/**
 * "Título: onde assistir" (formato comum dos posts de lista): à direita do último ": " vem um serviço
 * ou a indisponibilidade. Só nomes conhecidos (lista ajustável); "2001: Uma Odisseia" fica intacto.
 */
const WATCH_SUFFIX =
  /^(netflix|prime\s*video|amazon(\s*prime)?(\s*video)?|disney\s*\+?|disney\s*plus|(hbo\s*)?max|globoplay|apple\s*tv\s*\+?|paramount\s*\+?|telecine|universal\s*\+?|mgm\s*\+?|plex|mubi|crunchyroll|star\s*\+|claro\s*tv\s*\+?|looke|pluto\s*tv|youtube|google\s*play|indispon[ií]vel|n[aã]o\s+(est[aá]\s+)?dispon[ií]vel|nos?\s+cinemas?|em\s+cartaz)(?![\p{L}\p{N}])/iu;

export function stripWatchSuffix(text: string): {
  text: string;
  stripped: boolean;
} {
  const idx = text.lastIndexOf(': ');
  if (idx <= 0) return { text, stripped: false };
  if (!WATCH_SUFFIX.test(text.slice(idx + 2).trim())) return { text, stripped: false };
  return { text: text.slice(0, idx).trim(), stripped: true };
}

/**
 * Marcador de lista que o OCR estragou: o mesmo emoji (🎬) no começo de cada item vira "EB", "@"…
 * Um prefixo curto (até 3 caracteres, sem dígito) repetido em 3+ linhas com cara de item é removido.
 */
const SHORT_PREFIX = /^([^\s\d]{1,3})\s+(?=\S)/u;
export function repeatedPrefixes(lines: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const m = SHORT_PREFIX.exec(l);
    if (!m?.[1]) continue;
    const rest = l.slice(m[0].length);
    if (stripWatchSuffix(rest).stripped || YEAR_IN_PARENS.test(rest)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 3).map(([p]) => p));
}

/** Linha que parece item de lista forte: tinha marcador de lista ou traz o ano "(2019)". */
const YEAR_IN_PARENS = /\((?:18|19|20)\d{2}\)/;

let seq = 0;
export function newCandidateId(): string {
  seq += 1;
  return `c${Date.now().toString(36)}${seq}`;
}

/**
 * Linhas do OCR → candidatos. Filtra só o óbvio (interface, linha vazia, lixo de leitura) e os
 * repetidos (a primeira ocorrência fica, com o texto como foi lido). Pré-seleção: se a imagem tem
 * itens com cara de lista (numerados, com marcador ou com ano), só eles vêm marcados; senão, as
 * linhas lidas com boa confiança. Tudo continua visível para o usuário marcar/desmarcar.
 */
export function extractCandidates(lines: readonly OcrLine[], makeId: () => string = newCandidateId): Candidate[] {
  const seen = new Set<string>();
  const rows: { text: string; strong: boolean; confidence: number }[] = [];
  const prefixes = repeatedPrefixes(lines.map((l) => normalizeSpaces(l.text)));
  for (const line of lines) {
    let raw = normalizeSpaces(line.text);
    if (!raw || isUiNoise(raw)) continue;
    let prefixed = false;
    const p = SHORT_PREFIX.exec(raw);
    if (p?.[1] && prefixes.has(p[1])) {
      const rest = raw.slice(p[0].length);
      if (stripWatchSuffix(rest).stripped || YEAR_IN_PARENS.test(rest)) {
        raw = rest;
        prefixed = true;
      }
    }
    const marker = stripListMarker(raw);
    const watch = stripWatchSuffix(marker.text);
    const text = watch.text;
    if (!text || isUiNoise(text) || isGarbled(text)) continue;
    const key = candidateKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      text,
      strong: prefixed || marker.marked || watch.stripped || YEAR_IN_PARENS.test(text),
      confidence: line.confidence,
    });
  }
  const hasStrong = rows.some((r) => r.strong);
  return rows.map((r) => {
    const selected = hasStrong ? r.strong : r.confidence >= UNCERTAIN_BELOW;
    return {
      id: makeId(),
      text: r.text,
      selected,
      visible: selected,
      kind: null,
      uncertain: r.confidence < UNCERTAIN_BELOW,
      source: 'ocr' as const,
    };
  });
}
