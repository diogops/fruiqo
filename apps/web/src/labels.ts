// Rótulos pt-BR para valores do contrato (só apresentação; nada de regra de negócio aqui).
import { RecommendationKindSchema, type PipelineStepName, type RecommendationKind, type TitleStatus } from '@fruiqo/contracts';

// Mapa por string (não Record<RecommendationKind>) para aceitar tipos novos do contrato sem quebrar:
// quando o contrato ganhar `book`, o rótulo já existe; tipos desconhecidos caem no fallback.
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

export const STATUS_LABEL: Record<TitleStatus, string> = {
  catalog: 'Catálogo',
  to_watch: 'Quero assistir',
  watching: 'Assistindo',
  watched: 'Assistido',
  dropped: 'Abandonei',
};

/** D-23: onde está assistindo (sugestões; o usuário pode digitar outro) */
export const WATCH_ON_OPTIONS = [
  'Netflix',
  'Prime Video',
  'Disney+',
  'Max',
  'Apple TV+',
  'Globoplay',
  'Paramount+',
  'Mubi',
  'Crunchyroll',
  'YouTube',
  'Cinema',
  'TV aberta',
];

/** D-23: ordenações do catálogo e da Minha Área (a padrão é ordem manual → estrelas → automática → geral) */
export const SORT_LABEL: Record<string, string> = {
  score: 'Recomendada',
  rank: 'Ordem manual',
  mine: 'Minhas estrelas',
  auto: 'Nota automática',
  general: 'Nota geral (TMDB)',
  recent: 'Mais recentes',
  title: 'Título',
};

/** D-23: ordem dos resultados de "Buscar mais títulos" */
export type SearchSort = 'score' | 'auto' | 'general' | 'relevance';
export const SEARCH_SORT_LABEL: Record<SearchSort, string> = {
  score: 'Recomendada',
  auto: 'Nota automática',
  general: 'Nota geral (TMDB)',
  relevance: 'Relevância',
};

/** nota com uma casa, em pt-BR (4,5) */
export function scoreText(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}


export const STEP_LABEL: Record<PipelineStepName, string> = {
  normalize: 'Normalização',
  metadata: 'Metadados (oEmbed)',
  ocr_input: 'Texto dos prints',
  merge_pages: 'Mescla de prints',
  noise_filter: 'Filtro de ruído',
  extract: 'Extração',
  dedup: 'Deduplicação',
  resolve: 'Resolução (TMDB/Spotify)',
  decide: 'Decisão',
};

export const DECISION_LABEL: Record<string, string> = {
  cataloged: 'Catalogado',
  review_queue: 'Revisão',
  discarded: 'Descartado',
};

export const SHARE_STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  processing: 'Processando',
  done: 'Pronto',
  failed: 'Falhou',
  rejected: 'Recusado',
};

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  other: 'Outro',
};

/** Tipos aceitos pelo contrato atual (inclui os novos automaticamente). */
export const KINDS: RecommendationKind[] = [...RecommendationKindSchema.options];
export const STATUSES = Object.keys(STATUS_LABEL) as TitleStatus[];
export const AREA_STATUSES: TitleStatus[] = ['to_watch', 'watching', 'watched'];

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatUsd(v: number): string {
  return v === 0 ? 'US$ 0' : `US$ ${v.toFixed(4)}`;
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
