// Rótulos pt-BR para valores do contrato (só apresentação; nada de regra de negócio aqui).
import type { PipelineStepName, RecommendationKind, TitleStatus } from '@fruiqo/contracts';

export const KIND_LABEL: Record<RecommendationKind, string> = {
  movie: 'Filme',
  series: 'Série',
  music_track: 'Música',
  music_album: 'Álbum',
  artist: 'Artista',
  other: 'Outro',
};

export const STATUS_LABEL: Record<TitleStatus, string> = {
  to_watch: 'Quero ver',
  watching: 'Assistindo',
  watched: 'Assisti',
  dropped: 'Abandonei',
};


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

export const KINDS = Object.keys(KIND_LABEL) as RecommendationKind[];
export const STATUSES = Object.keys(STATUS_LABEL) as TitleStatus[];

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatUsd(v: number): string {
  return v === 0 ? 'US$ 0' : `US$ ${v.toFixed(4)}`;
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
