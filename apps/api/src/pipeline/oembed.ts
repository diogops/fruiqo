import type { Platform } from '@fruiqo/contracts';
import { z } from 'zod';
import { safeFetchJson, type SafeFetchOptions } from './safe-fetch.js';

export interface SourceMetadata {
  title?: string;
  author?: string;
  thumbnailUrl?: string;
}

// Só os campos que usamos; o resto da resposta é descartado.
const OEmbedSchema = z.object({
  title: z.string().max(500).optional(),
  author_name: z.string().max(200).optional(),
  thumbnail_url: z.url({ protocol: /^https$/ }).max(2048).optional(),
});

const GRAPH_VERSION = 'v23.0';

/**
 * Metadados só via oEmbed oficial (ARB-REQ-01, TOS-REQ-08/09). Instagram exige token de app da
 * Meta; sem ele, não busca nada. Plataformas fora da allowlist nunca chegam aqui.
 */
export async function fetchOEmbed(
  platform: Platform,
  url: string,
  opts: { metaAccessToken?: string; fetchImpl?: SafeFetchOptions['fetchImpl'] } = {},
): Promise<SourceMetadata | null> {
  let endpoint: string | null = null;
  const q = encodeURIComponent(url);
  switch (platform) {
    case 'youtube':
      endpoint = `https://www.youtube.com/oembed?format=json&url=${q}`;
      break;
    case 'tiktok':
      endpoint = `https://www.tiktok.com/oembed?url=${q}`;
      break;
    case 'instagram':
      if (opts.metaAccessToken) {
        endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/instagram_oembed?url=${q}&fields=title,author_name,thumbnail_url&access_token=${encodeURIComponent(opts.metaAccessToken)}`;
      }
      break;
    case 'other':
      break;
  }
  if (!endpoint) return null;

  const raw = await safeFetchJson(endpoint, { fetchImpl: opts.fetchImpl });
  const parsed = OEmbedSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...(parsed.data.title ? { title: parsed.data.title.trim() } : {}),
    ...(parsed.data.author_name ? { author: parsed.data.author_name.trim() } : {}),
    ...(parsed.data.thumbnail_url ? { thumbnailUrl: parsed.data.thumbnail_url } : {}),
  };
}
