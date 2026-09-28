import type { Resolution } from '@fruiqo/contracts';
import { z } from 'zod';
import type { ExtractedItem } from '../extractors/types.js';
import { safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';

const API = 'https://api.themoviedb.org/3';

const SearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      media_type: z.string().optional(),
      title: z.string().optional(),
      name: z.string().optional(),
      release_date: z.string().optional(),
      first_air_date: z.string().optional(),
      poster_path: z.string().nullable().optional(),
    }),
  ),
});

const ProvidersSchema = z.object({
  results: z.record(
    z.string(),
    z.object({ flatrate: z.array(z.object({ provider_name: z.string() })).optional() }),
  ),
});

/** Resolução de filmes/séries + onde assistir no Brasil (RF-05/RF-06, TOS-REQ-01/02). */
export class TmdbResolver {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: SafeFetchOptions['fetchImpl'],
  ) {}

  supports(item: ExtractedItem): boolean {
    return item.kind === 'movie' || item.kind === 'series';
  }

  async resolve(item: ExtractedItem): Promise<Resolution | null> {
    const params = new URLSearchParams({ query: item.title, language: 'pt-BR', include_adult: 'false' });
    const search = SearchSchema.parse(await this.get(`/search/multi?${params}`));

    const wanted = item.kind === 'series' ? 'tv' : 'movie';
    const hit =
      search.results.find((r) => r.media_type === wanted) ??
      search.results.find((r) => r.media_type === 'movie' || r.media_type === 'tv');
    if (!hit) return null;

    const media = hit.media_type === 'tv' ? 'tv' : 'movie';
    const date = hit.release_date || hit.first_air_date;
    const year = date ? Number(date.slice(0, 4)) : undefined;

    let watchProvidersBR: string[] | undefined;
    try {
      const providers = ProvidersSchema.parse(await this.get(`/${media}/${hit.id}/watch/providers`));
      const br = providers.results.BR?.flatrate?.map((p) => p.provider_name);
      if (br && br.length > 0) watchProvidersBR = br;
    } catch {
      // disponibilidade é opcional; a resolução continua válida sem ela
    }

    return {
      provider: 'tmdb',
      externalId: `${media}:${hit.id}`,
      title: hit.title ?? hit.name ?? item.title,
      url: `https://www.themoviedb.org/${media}/${hit.id}`,
      ...(hit.poster_path ? { imageUrl: `https://image.tmdb.org/t/p/w342${hit.poster_path}` } : {}),
      ...(year && Number.isInteger(year) ? { year } : {}),
      ...(watchProvidersBR ? { watchProvidersBR } : {}),
    };
  }

  private get(path: string) {
    // Chave v3 (32 hex) vai na query; token v4 (JWT longo) vai no header.
    const isV4 = this.apiKey.length > 40;
    const url = isV4 ? `${API}${path}` : `${API}${path}${path.includes('?') ? '&' : '?'}api_key=${this.apiKey}`;
    return safeFetchJson(url, {
      headers: isV4 ? { authorization: `Bearer ${this.apiKey}` } : {},
      fetchImpl: this.fetchImpl,
    });
  }
}
