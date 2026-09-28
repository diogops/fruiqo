import type { Share } from '@fruiqo/contracts';

const PLATFORM_LABEL: Record<Share['source']['platform'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  other: 'Link',
};

/** Rótulo curto da origem: "Prints" para OCR de prints, senão o nome da plataforma. */
export function sourceLabel(source: Share['source']): string {
  return source.origin === 'screenshot' ? 'Prints' : PLATFORM_LABEL[source.platform];
}

/** Título do card/detalhe: para prints, "Prints (N)"; para links, o título do oEmbed ou a URL. */
export function sourceTitle(source: Share['source']): string {
  if (source.origin === 'screenshot') {
    const n = source.pageCount;
    return n ? `Prints (${n})` : 'Prints';
  }
  return source.title ?? source.url ?? 'Compartilhamento';
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
