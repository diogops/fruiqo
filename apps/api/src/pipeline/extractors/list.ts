import type { RecommendationKind } from '@fruiqo/contracts';
import { normalizeText } from '../dedup.js';
import { isUiNoise } from '../ui-noise.js';
import type { ExtractedItem } from './types.js';

export const MAX_LIST_ITEMS = 50;

// "1️⃣" → "1. " antes de tudo (o emoji keycap é dígito + FE0F + U+20E3).
const KEYCAP = /(\d)️?⃣\s*/gu;
// "1.", "1)", "01 -", "1º", "10:", "#1", "#1 -"
const NUMBERED = /^(?:#\s*\d{1,3}\s*[.):\-–—]?\s+|\d{1,3}\s*(?:[.)º°ª:]|\s?[-–—])\s*)(.+)$/u;
const BULLET = /^[•▪►▶●◦*·✅✔☑👉🎬🎥🎞📺🍿🎵🎶🎧⭐★➡→\-–—]️?\s*(.+)$/u;
// marcador sozinho numa linha (o OCR separou "1." do título)
const ORPHAN_MARKER = /^(?:#\s*)?\d{1,3}\s*[.)º°ª:\-–—]?$|^[•▪►▶●◦*·]$/u;
const YEAR_PARENS = /\((?:19|20)\d{2}\)/;
const YEAR_TRAILING = /\s*[-–—,|]\s*((?:19|20)\d{2})\s*$/;
const DASH_PAIR = /^(.{1,60}?)\s+[-–—]\s+(.{1,80})$/u;
const BY_ARTIST = /^(.{1,80}?)\s+by\s+(.{1,60})$/iu;

const PLATFORMS =
  'netflix|prime video|amazon prime( video)?|disney\\+|disney plus|hbo max|max|globoplay|apple tv\\+?|star\\+|paramount\\+|mubi|crunchyroll|spotify|deezer|youtube( music)?|apple music|tidal';
const PLATFORM_SUFFIX = new RegExp(`\\s*(?:[-–—|]\\s*|\\((?=[^)]*\\)$)|\\b(?:na|no|on|in|via)\\s+)(?:${PLATFORMS})\\)?\\s*$`, 'iu');
// nota/estrelas/emojis no fim: "⭐ 8.5", "★★★★", "🔥🔥", "8/10" (número solto no fim NÃO: "Toy Story 3")
const TRAILING_DECOR = /(?:\s*[\p{Extended_Pictographic}️★☆]+[\s\d.,/]*)+$|\s+\d{1,2}(?:[.,]\d)?\s*\/\s*10$/u;

const HINTS: { kind: RecommendationKind; re: RegExp }[] = [
  { kind: 'movie', re: /\b(filmes?|movies?|films?|cinema|longas?)\b/g },
  { kind: 'series', re: /\b(series?|temporadas?|seasons?|episodios?|episodes?|minisseries?|doramas?|animes?)\b/g },
  { kind: 'music_track', re: /\b(musicas?|songs?|playlists?|faixas?|tracks?|cancoes|cancao|hits?)\b/g },
  { kind: 'music_album', re: /\b(albuns?|albums?|discos?)\b/g },
  // RF-48
  { kind: 'book', re: /\b(livros?|books?|leituras?|literatura|autora?|autores|(?:para|pra) ler)\b/g },
];

/** Tipo predominante pelo vocabulário do texto inteiro; empate filme×série fica com filme. */
export function contextKind(text: string): RecommendationKind | null {
  const n = normalizeText(text);
  let best: RecommendationKind | null = null;
  let bestCount = 0;
  for (const h of HINTS) {
    const count = n.match(h.re)?.length ?? 0;
    if (count > bestCount) {
      best = h.kind;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Ordem de "A - B" em contexto musical. Em listas pt-BR escritas pelo usuário ("Músicas:",
 * "Playlist:") o padrão é "Música - Artista" ("Aquarela - Toquinho"). "Artista - Música" só vale
 * com pista explícita no texto ("(artista - música)", "Banda – Faixa"). Sem contexto musical
 * nenhum (hint null), segue a convenção de título de vídeo "Artista - Música".
 */
export type MusicOrder = 'title_first' | 'artist_first';
const ARTIST_WORDS = '(?:artistas?|bandas?|cantor(?:a|es)?|interpretes?|artists?|bands?|singers?)';
const SONG_WORDS = '(?:musicas?|faixas?|cancao|cancoes|songs?|tracks?|titulos?|titles?)';
const ORDER_ARTIST_FIRST = new RegExp(String.raw`\b${ARTIST_WORDS}\s*[-–—/x]\s*${SONG_WORDS}\b`);
const ORDER_TITLE_FIRST = new RegExp(String.raw`\b${SONG_WORDS}\s*[-–—/x]\s*${ARTIST_WORDS}\b`);

export function musicOrder(text: string): MusicOrder {
  const n = normalizeText(text);
  if (ORDER_ARTIST_FIRST.test(n)) return 'artist_first';
  return 'title_first';
}

function isMusic(kind: RecommendationKind | null) {
  return kind === 'music_track' || kind === 'music_album' || kind === 'artist';
}

function cleanPart(s: string): string {
  return s
    .replace(PLATFORM_SUFFIX, '')
    .replace(TRAILING_DECOR, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«».,;:!]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function plausibleTitle(s: string, marked = false): boolean {
  if (s.length < 1 || s.length > 120) return false;
  if (s.split(/\s+/).length > 12) return false;
  // pergunta solta é conversa; num item de lista pode ser título ("Que Horas Ela Volta?")
  if (!marked && /[?]$/.test(s)) return false;
  return /\p{L}/u.test(s) || /^\d{3,4}$/.test(s);
}

/** Pré-processa as linhas: keycaps, marcadores órfãos juntados ao título, ruído de UI removido. */
function prepareLines(text: string): string[] {
  const raw = text.replace(KEYCAP, '$1. ').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    const next = raw[i + 1];
    if (ORPHAN_MARKER.test(line) && next && !ORPHAN_MARKER.test(next)) {
      joined.push(`${line.endsWith('.') || line.endsWith(')') ? line : `${line}.`} ${next}`);
      i++;
    } else {
      joined.push(line);
    }
  }
  return joined.filter((l) => !isUiNoise(l));
}

/**
 * Extrai itens de lista de um texto (legenda ou OCR de prints já mesclados), sem rede.
 * Só linhas com cara de item viram recomendação: numeradas, com bullet, "Título (2019)" ou,
 * em contexto musical/neutro, "Artista - Música". Linhas soltas sem marcador são ignoradas
 * (limitação conhecida: carrossel com um título por slide sem numeração).
 */
export function extractListItems(text: string): ExtractedItem[] {
  const hint = contextKind(text);
  const order = musicOrder(text);
  const items: ExtractedItem[] = [];
  // RF-47: cabeçalho só com o tipo ("Séries:", "Filmes:") abre uma seção em que toda linha curta é item
  let section: RecommendationKind | null = null;

  for (const line of prepareLines(text)) {
    const header = sectionHeader(line);
    if (header !== undefined) {
      section = header;
      continue;
    }
    let body: string | null = null;
    let marked = false;
    const numbered = NUMBERED.exec(line);
    const bullet = numbered ? null : BULLET.exec(line);
    if (numbered?.[1]) {
      body = numbered[1];
      marked = true;
    } else if (bullet?.[1]) {
      body = bullet[1];
      marked = true;
    } else if (YEAR_PARENS.test(line) || (DASH_PAIR.test(line) && (hint === null || isMusic(hint)))) {
      body = line;
    } else if (section && isShortLine(line)) {
      body = line;
      marked = true;
    }
    if (!body) continue;
    // cabeçalho de lista ("Top 10 filmes de 2024:"), não item
    if (/:\s*$/.test(body)) continue;

    const item = parseBody(body, section ?? hint, marked, order);
    if (item) items.push(item);
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

/** Palavras de cabeçalho de seção → tipo. */
const SECTION_KINDS: { kind: RecommendationKind; re: RegExp }[] = [
  { kind: 'movie', re: /^(meus |minha lista de |lista de )?(filmes?|movies?|films?|longas?)( para ver| pra ver| favoritos?)?$/ },
  { kind: 'series', re: /^(minhas |minha lista de |lista de )?(series?|seriados?|tv shows?|shows?|doramas?|animes?|minisseries?)( para ver| pra ver| favoritas?)?$/ },
  { kind: 'music_track', re: /^(minhas |minha |lista de )?(musicas?|songs?|faixas?|tracks?|cancoes|playlists?)( favoritas?| para ouvir| pra ouvir)?$/ },
  { kind: 'music_album', re: /^(meus |lista de )?(albuns?|albums?|discos?)( favoritos?)?$/ },
  { kind: 'book', re: /^(meus |minhas |minha lista de |lista de )?(livros?|books?|leituras?)( para ler| pra ler| favorit[oa]s?)?$/ },
];

/**
 * Linha que é só um cabeçalho de seção ("Series:", "Filmes", "## Músicas"): devolve o tipo
 * (null = cabeçalho sem tipo conhecido, que encerra a seção anterior); undefined = não é cabeçalho.
 */
export function sectionHeader(line: string): RecommendationKind | null | undefined {
  const trimmed = line.trim();
  const withColon = /:\s*$/.test(trimmed);
  const n = normalizeText(trimmed.replace(/^#+\s*/, '').replace(/:\s*$/, ''));
  if (!n) return undefined;
  const found = SECTION_KINDS.find((s) => s.re.test(n));
  if (found) return found.kind;
  // linha com a pista de ordem ("Artista - Música:", "Playlist (música – artista)") é instrução,
  // nunca uma faixa: vira cabeçalho de seção musical
  if (ORDER_ARTIST_FIRST.test(n) || ORDER_TITLE_FIRST.test(n)) return 'music_track';
  // "Outros:" / "Para depois:" encerram a seção; título com dois-pontos no meio não é cabeçalho
  if (withColon && n.split(' ').length <= 4 && !YEAR_PARENS.test(trimmed)) return null;
  return undefined;
}

function isShortLine(line: string): boolean {
  if (/https?:\/\//i.test(line)) return false;
  return line.length <= 120 && line.split(/\s+/).length <= 12;
}

/**
 * RF-47: arquivo .txt com um título por linha. Diferente de legenda/OCR, toda linha curta é item,
 * com ou sem marcador/ano; cabeçalhos de seção ("Series:", "Filmes:", "Músicas:") definem o tipo.
 * Sem cabeçalho, o tipo vem do vocabulário do arquivo (ou do nome do arquivo, em `nameHint`).
 */
export function extractTextFileItems(text: string, nameHint?: string): ExtractedItem[] {
  const fallback = contextKind(text) ?? (nameHint ? contextKind(nameHint) : null);
  const order = musicOrder(text);
  const items: ExtractedItem[] = [];
  let section: RecommendationKind | null = null;

  const lines = text
    .replace(KEYCAP, '$1. ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    // só descarta linha sem letra/dígito (separador, emoji); nada de filtro de UI de rede social
    .filter((l) => /[\p{L}\p{N}]/u.test(l));
  for (const line of lines) {
    const header = sectionHeader(line);
    if (header !== undefined) {
      section = header;
      continue;
    }
    if (!isShortLine(line)) continue;
    const numbered = NUMBERED.exec(line);
    const bullet = numbered ? null : BULLET.exec(line);
    const body = numbered?.[1] ?? bullet?.[1] ?? line;
    const item = parseBody(body, section ?? fallback, true, order);
    if (!item) continue;
    // numa seção declarada o tipo é certo; sem seção, a confiança fica abaixo da de lista marcada
    item.confidence = section ? 0.65 : fallback ? 0.55 : 0.45;
    items.push(item);
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
}

function parseBody(
  body: string,
  hint: RecommendationKind | null,
  marked: boolean,
  order: MusicOrder = 'title_first',
): ExtractedItem | null {
  let rest = body.trim();
  let year: number | undefined;

  const yp = YEAR_PARENS.exec(rest);
  if (yp) {
    year = Number(yp[0].slice(1, 5));
    rest = (rest.slice(0, yp.index) + rest.slice(yp.index + yp[0].length)).trim();
  } else {
    const yt = YEAR_TRAILING.exec(rest);
    if (yt?.[1]) {
      year = Number(yt[1]);
      rest = rest.slice(0, yt.index).trim();
    }
  }
  rest = cleanPart(rest);

  let kind: RecommendationKind = hint ?? (year ? 'movie' : 'other');
  let title = rest;
  let creator: string | undefined;

  const dash = DASH_PAIR.exec(rest);
  const by = dash ? null : BY_ARTIST.exec(rest);
  const pair = dash ?? by;
  if (hint === 'book' && pair?.[1] && pair[2]) {
    // RF-48: "Título - Autor" / "Título by Autor"
    title = cleanPart(pair[1]);
    creator = cleanPart(pair[2]);
  } else if (dash?.[1] && dash[2]) {
    if (isMusic(hint)) {
      // contexto musical: "Música - Artista" por padrão; "Artista - Música" só com pista explícita
      const artistFirst = order === 'artist_first';
      creator = cleanPart(artistFirst ? dash[1] : dash[2]);
      title = cleanPart(artistFirst ? dash[2] : dash[1]);
    } else if (hint === null && !year) {
      // sem contexto nenhum: convenção de título de vídeo "Artista - Música"
      creator = cleanPart(dash[1]);
      title = cleanPart(dash[2]);
      kind = 'music_track';
    } else {
      // filme/série: o lado direito costuma ser gênero/descrição/plataforma
      title = cleanPart(dash[1]);
    }
  } else if (hint !== 'book' && by?.[1] && by[2] && (isMusic(hint) || hint === null)) {
    title = cleanPart(by[1]);
    creator = cleanPart(by[2]);
    if (hint === null) kind = 'music_track';
  }

  if (!plausibleTitle(title, marked)) return null;
  if (creator !== undefined && !plausibleTitle(creator)) creator = undefined;

  const confidence = marked ? (hint ? 0.6 : 0.45) : year ? (hint ? 0.55 : 0.5) : 0.4;
  return {
    kind,
    title: title.slice(0, 200),
    ...(creator ? { creator: creator.slice(0, 200) } : {}),
    ...(year ? { year } : {}),
    confidence,
  };
}
