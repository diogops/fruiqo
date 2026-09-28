import type { Resolution, WatchProvider } from '@fruiqo/contracts';
import { z } from 'zod';
import { providerKeyFromTmdbName } from '../../library/providers.js';
import type { ExtractedItem } from '../extractors/types.js';
import { safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

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

const ProviderEntry = z.object({
  provider_name: z.string(),
  logo_path: z.string().nullable().optional(),
  display_priority: z.number().optional(),
});
const ProvidersRegion = z.object({
  link: z.string().optional(),
  flatrate: z.array(ProviderEntry).optional(),
  rent: z.array(ProviderEntry).optional(),
  buy: z.array(ProviderEntry).optional(),
});

/** GET /{movie|tv}/{id}?append_to_response=external_ids,watch/providers (uma chamada só). */
const DetailsSchema = z.object({
  id: z.number().int(),
  title: z.string().optional(),
  name: z.string().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  runtime: z.number().int().nullable().optional(),
  episode_run_time: z.array(z.number().int()).optional(),
  genres: z.array(z.object({ id: z.number().int() })).optional(),
  external_ids: z.object({ imdb_id: z.string().nullable().optional() }).optional(),
  'watch/providers': z.object({ results: z.record(z.string(), ProvidersRegion) }).optional(),
});

export interface TmdbQuery {
  title: string;
  kind: 'movie' | 'series';
  year?: number;
}

/**
 * Resolução de filmes/séries + enriquecimento (RF-05/06/38; TOS-REQ-01/02). Tudo passa pelo
 * `fetchImpl` do PipelineGateway (mock/live/record). Os dados daqui nunca vão para o LLM (ARB-REQ-02).
 */
export class TmdbResolver {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: SafeFetchOptions['fetchImpl'],
  ) {}

  supports(item: ExtractedItem): boolean {
    return item.kind === 'movie' || item.kind === 'series';
  }

  resolve(item: ExtractedItem): Promise<Resolution | null> {
    return this.lookup({ title: item.title, kind: item.kind as TmdbQuery['kind'], ...(item.year ? { year: item.year } : {}) });
  }

  async lookup(q: TmdbQuery): Promise<Resolution | null> {
    const params = new URLSearchParams({ query: q.title, language: 'pt-BR', include_adult: 'false' });
    const search = SearchSchema.parse(await this.get(`/search/multi?${params}`));

    const wanted = q.kind === 'series' ? 'tv' : 'movie';
    const media = search.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
    const yearOf = (r: (typeof media)[number]) => {
      const d = r.release_date || r.first_air_date;
      return d ? Number(d.slice(0, 4)) : undefined;
    };
    // mesmo tipo e mesmo ano > mesmo tipo > qualquer filme/série (ordem de relevância do TMDB)
    const hit =
      (q.year ? media.find((r) => r.media_type === wanted && yearOf(r) === q.year) : undefined) ??
      media.find((r) => r.media_type === wanted) ??
      media[0];
    if (!hit) return null;

    const mediaType = hit.media_type === 'tv' ? 'tv' : 'movie';
    const year = yearOf(hit);
    const base: Resolution = {
      provider: 'tmdb',
      externalId: `${mediaType}:${hit.id}`,
      title: hit.title ?? hit.name ?? q.title,
      url: `https://www.themoviedb.org/${mediaType}/${hit.id}`,
      tmdbId: hit.id,
      mediaType,
      ...(hit.poster_path ? { imageUrl: `${IMG}/w342${hit.poster_path}` } : {}),
      ...(year && Number.isInteger(year) ? { year } : {}),
    };

    try {
      const detailParams = new URLSearchParams({ language: 'pt-BR', append_to_response: 'external_ids,watch/providers' });
      const d = DetailsSchema.parse(await this.get(`/${mediaType}/${hit.id}?${detailParams}`));
      return { ...base, ...detailFields(d) };
    } catch {
      // detalhes são opcionais: a correspondência continua válida sem eles
      return base;
    }
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

function detailFields(d: z.infer<typeof DetailsSchema>): Partial<Resolution> {
  const out: Partial<Resolution> = {};
  if (d.overview) out.overview = d.overview.slice(0, 4000);
  if (d.poster_path) out.imageUrl = `${IMG}/w342${d.poster_path}`;
  const runtime = d.runtime ?? d.episode_run_time?.[0];
  if (runtime && runtime > 0) out.runtimeMin = runtime;
  if (d.genres?.length) out.genreIds = d.genres.map((g) => g.id);
  if (d.external_ids?.imdb_id) out.imdbId = d.external_ids.imdb_id;

  const br = d['watch/providers']?.results.BR;
  if (br) {
    const providers: WatchProvider[] = [];
    for (const type of ['flatrate', 'rent', 'buy'] as const) {
      const seen = new Set<string>();
      for (const p of [...(br[type] ?? [])].sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))) {
        if (seen.has(p.provider_name)) continue;
        seen.add(p.provider_name);
        // chave de assinatura (RF-38) só na linha de assinatura; aluguel/compra não contam como "você assina"
        const key = type === 'flatrate' ? providerKeyFromTmdbName(p.provider_name) : undefined;
        providers.push({
          name: p.provider_name,
          type,
          ...(key ? { key } : {}),
          ...(p.logo_path ? { logoUrl: `${IMG}/w92${p.logo_path}` } : {}),
        });
      }
    }
    if (providers.length > 0) {
      out.providers = providers;
      const flat = providers.filter((p) => p.type === 'flatrate').map((p) => p.name);
      if (flat.length > 0) out.watchProvidersBR = flat;
    }
    // só aceitamos o link público do próprio TMDB (nada de deep link para os apps, TOS-REQ-17)
    if (br.link?.startsWith('https://www.themoviedb.org/')) out.watchUrl = br.link;
  }
  return out;
}
