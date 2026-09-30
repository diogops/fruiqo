import type { Recommendation, Share, TitleStatus } from '@fruiqo/contracts';

const PLATFORM_LABEL: Record<Share['source']['platform'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  other: 'Link',
};

/** Rótulo curto da origem: "Prints" para OCR de prints, senão o nome da plataforma. */
export function sourceLabel(source: Share['source']): string {
  if (source.origin === 'text_file') return 'Arquivo .txt';
  if (source.origin === 'text') return 'Texto';
  return source.origin === 'screenshot' ? 'Prints' : PLATFORM_LABEL[source.platform];
}

/** Título do card/detalhe: para prints, "Prints (N)"; para links, o título do oEmbed ou a URL. */
export function sourceTitle(source: Share['source']): string {
  if (source.origin === 'text_file') return source.title ?? 'Lista em .txt';
  if (source.origin === 'text') return source.title ?? 'Texto colado';
  if (source.origin === 'screenshot') {
    const n = source.pageCount;
    return n ? `Prints (${n})` : 'Prints';
  }
  return source.title ?? source.url ?? 'Compartilhamento';
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// ---------- Catálogo ----------


// Genérico de propósito: tipos novos no contrato (ex.: `book`) funcionam antes de ganharem rótulo aqui.
export const KIND_LABEL: Record<string, string> = {
  movie: 'Filme',
  series: 'Série',
  book: 'Livro',
  music_track: 'Música',
  music_album: 'Álbum',
  artist: 'Artista',
  other: 'Outro',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');
}

export const TITLE_STATUS_LABEL: Record<TitleStatus, string> = {
  catalog: 'Catálogo',
  to_watch: 'Quero assistir',
  watching: 'Assistindo',
  watched: 'Assistido',
  dropped: 'Abandonei',
};

/** Posição na fila de prioridade: "#3 de 42" (1 = mais prioritário). */
export function rankLabel(rank: number | null, total?: number): string {
  if (rank == null) return 'Fora da fila (em revisão)';
  return total ? `#${rank} de ${total}` : `#${rank}`;
}

/** Motivos de feedback em uma palavra (RF-37); chaves de REASON_TAGS da taxonomia. */
export const REASON_OPTIONS: { key: string; label: string }[] = [
  { key: 'too_heavy', label: 'Pesado demais' },
  { key: 'seen_it', label: 'Já vi' },
  { key: 'not_in_mood', label: 'Não estou no clima' },
  { key: 'too_long', label: 'Longo demais' },
  { key: 'too_slow', label: 'Lento' },
  { key: 'not_my_genre', label: 'Não é meu gênero' },
  { key: 'not_available', label: 'Não tenho onde ver' },
];

/** "Filme · 2023 · Comédia, Romance" */
export function titleMeta(t: { kind: string; year?: number; genres: { label: string }[] }): string {
  return [kindLabel(t.kind), t.year, t.genres.map((g) => g.label).join(', ') || undefined]
    .filter(Boolean)
    .join(' · ');
}

// Fonte do metadado (link de volta + atribuição, TOS-REQ-01/10); genérico para fontes novas.
const PROVIDER_LABEL: Record<string, string> = { tmdb: 'TMDB', spotify: 'Spotify', openlibrary: 'Open Library' };

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}
