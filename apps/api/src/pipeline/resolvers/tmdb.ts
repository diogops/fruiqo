import type { Resolution, WatchProvider } from '@fruiqo/contracts';
import { z } from 'zod';
import { providerKeyFromTmdbName } from '../../library/providers.js';
import type { MatchAlternativeRow } from '../../db/schema.js';
import type { ExtractedItem } from '../extractors/types.js';
import { fetchTitleLinks } from './wikidata.js';
import { safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';
import { type MatchCandidate, matchScore, STRONG_MATCH } from './match.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const SearchHit = z.object({
  id: z.number().int(),
  media_type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  popularity: z.number().optional(),
  genre_ids: z.array(z.number().int()).optional(),
  vote_average: z.number().optional(),
  vote_count: z.number().int().optional(),
});
type Hit = z.infer<typeof SearchHit>;
const SearchSchema = z.object({ results: z.array(SearchHit) });

const PersonHit = z.object({
  id: z.number().int(),
  name: z.string(),
  popularity: z.number().optional(),
  known_for_department: z.string().optional(),
});
const PersonSearchSchema = z.object({ results: z.array(PersonHit) });

export interface TmdbPerson {
  id: number;
  name: string;
  popularity: number;
  department?: string;
}
const CreditsSchema = z.object({
  cast: z.array(SearchHit.extend({ character: z.string().optional() })).optional(),
  crew: z.array(SearchHit.extend({ job: z.string().optional() })).optional(),
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
  vote_average: z.number().optional(),
  vote_count: z.number().int().optional(),
  external_ids: z.object({ imdb_id: z.string().nullable().optional() }).optional(),
  'watch/providers': z.object({ results: z.record(z.string(), ProvidersRegion) }).optional(),
  credits: z.object({ cast: z.array(z.object({ name: z.string(), order: z.number().optional() })).optional() }).optional(),
});

export interface TmdbQuery {
  title: string;
  kind: 'movie' | 'series';
  year?: number;
}

/** Resultado de resolução com a aderência do match e as outras opções (RF-47). */
export interface DetailedResolution {
  resolution: Resolution | null;
  /** aderência do match escolhido ao texto importado (0..1) */
  score: number | null;
  alternatives: MatchAlternativeRow[];
}

/** Resultado de busca normalizado (RF-46). */
export interface TmdbHit {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  year?: number;
  posterUrl?: string;
  overview?: string;
  popularity: number;
  genreIds: number[];
  /** D-23: nota geral do TMDB (0..10) e votos */
  voteAverage?: number;
  voteCount?: number;
}

const MAX_ALTERNATIVES = 3;
/** TV: 10763 News, 10767 Talk (e premiações entram por "Self") */
const NON_WORK_TV_GENRES = new Set([10763, 10767]);
const SELF_CHARACTER = /^(self|himself|herself|themselves|ele mesmo|ela mesma|si mesmo|narrator \(voice\) - self)\b/i;
const MIN_ALTERNATIVE_SCORE = 0.3;

/**
 * Resolução de filmes/séries + enriquecimento (RF-05/06/38; TOS-REQ-01/02) e buscas do RF-46.
 * Tudo passa pelo `fetchImpl` do PipelineGateway (mock/live/record). Os dados daqui nunca vão para
 * o LLM (ARB-REQ-02).
 */
export class TmdbResolver {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: SafeFetchOptions['fetchImpl'],
  ) {}

  supports(item: ExtractedItem): boolean {
    return item.kind === 'movie' || item.kind === 'series';
  }

  async resolve(item: ExtractedItem): Promise<Resolution | null> {
    return (await this.resolveDetailed(item)).resolution;
  }

  resolveDetailed(item: ExtractedItem): Promise<DetailedResolution> {
    return this.lookupDetailed({ title: item.title, kind: item.kind as TmdbQuery['kind'], ...(item.year ? { year: item.year } : {}) });
  }

  async lookup(q: TmdbQuery): Promise<Resolution | null> {
    return (await this.lookupDetailed(q)).resolution;
  }

  /**
   * Busca por título, pontua os candidatos por título/ano/tipo (match.ts) e escolhe o melhor.
   * Match fraco (abaixo de STRONG_MATCH) tenta de novo com as palavras mais longas do título,
   * filtrando pelo ano e pelo tipo: pega erro de digitação ("Back Bird" → "Black Bird").
   * Chamadas extras que falham (ex.: sem gravação no modo mock) são ignoradas.
   */
  async lookupDetailed(q: TmdbQuery): Promise<DetailedResolution> {
    const params = new URLSearchParams({ query: q.title, language: 'pt-BR', include_adult: 'false' });
    const search = SearchSchema.parse(await this.get(`/search/multi?${params}`));
    const wanted = q.kind === 'series' ? 'tv' : 'movie';
    const mq = { title: q.title, ...(q.year ? { year: q.year } : {}), mediaType: wanted } as const;

    const pool = new Map<string, TmdbHit>();
    for (const r of search.results) {
      const hit = toHit(r);
      if (hit) pool.set(`${hit.mediaType}:${hit.tmdbId}`, hit);
    }
    let ranked = rank(pool, mq);
    if ((ranked[0]?.score ?? 0) < STRONG_MATCH) {
      for (const hit of await this.fuzzyRetry(q, wanted)) pool.set(`${hit.mediaType}:${hit.tmdbId}`, hit);
      ranked = rank(pool, mq);
    }
    const best = ranked[0];
    if (!best) return { resolution: null, score: null, alternatives: [] };

    const alternatives: MatchAlternativeRow[] = ranked
      .slice(1)
      .filter((r) => r.score >= MIN_ALTERNATIVE_SCORE)
      .slice(0, MAX_ALTERNATIVES)
      .map(({ hit, score }) => ({
        tmdbId: hit.tmdbId,
        mediaType: hit.mediaType,
        title: hit.title,
        ...(hit.year ? { year: hit.year } : {}),
        ...(hit.posterUrl ? { posterUrl: hit.posterUrl } : {}),
        ...(hit.overview ? { overview: hit.overview.slice(0, 400) } : {}),
        score,
      }));
    const resolution = await this.byId(best.hit.mediaType, best.hit.tmdbId, best.hit);
    return { resolution, score: best.score, alternatives };
  }

  /** Detalhes de um título escolhido (alternativa, busca RF-46, favorito RF-43). */
  async byId(mediaType: 'movie' | 'tv', id: number, hint?: TmdbHit, opts: { titleLinks?: boolean } = {}): Promise<Resolution | null> {
    const base: Resolution | null = hint ? baseResolution(hint) : null;
    try {
      const detailParams = new URLSearchParams({ language: 'pt-BR', append_to_response: 'external_ids,watch/providers' });
      const d = DetailsSchema.parse(await this.get(`/${mediaType}/${id}?${detailParams}`));
      const title = d.title ?? d.name;
      if (!base && !title) return null;
      const year = yearOf(d.release_date || d.first_air_date);
      const head = base ?? baseResolution({ tmdbId: d.id, mediaType, title: title!, ...(year ? { year } : {}) });
      const details = detailFields(d);
      // D-22: link direto ao título em cada serviço, só quando há onde assistir no Brasil
      // (a atualização agendada pula: reaproveita os links já gravados)
      if (opts.titleLinks === false) return { ...head, ...details };
      const titleLinks = details.providers?.length ? await fetchTitleLinks(mediaType, id, this.fetchImpl) : {};
      // vazio também é gravado: marca que o Wikidata já foi consultado (não repete a cada abertura)
      return { ...head, ...details, ...(details.providers?.length ? { titleLinks } : {}) };
    } catch {
      // detalhes são opcionais: a correspondência continua válida sem eles
      return base;
    }
  }

  // ---------- RF-46: buscas ----------

  /** search/multi: títulos e pessoas (a mesma chamada serve para "Wagner Moura" e "Duna"). */
  async searchMulti(query: string): Promise<{ titles: TmdbHit[]; people: TmdbPerson[] }> {
    const params = new URLSearchParams({ query, language: 'pt-BR', include_adult: 'false' });
    const raw = z.object({ results: z.array(z.record(z.string(), z.unknown())) }).parse(await this.get(`/search/multi?${params}`));
    const titles: TmdbHit[] = [];
    const people: TmdbPerson[] = [];
    for (const r of raw.results) {
      if (r.media_type === 'person') {
        const p = PersonHit.safeParse(r);
        if (p.success) people.push({ id: p.data.id, name: p.data.name, popularity: p.data.popularity ?? 0, ...(p.data.known_for_department ? { department: p.data.known_for_department } : {}) });
        continue;
      }
      const h = SearchHit.safeParse(r);
      const hit = h.success ? toHit(h.data) : null;
      if (hit) titles.push(hit);
    }
    return { titles, people };
  }

  async searchPerson(name: string): Promise<TmdbPerson | null> {
    const params = new URLSearchParams({ query: name, language: 'pt-BR', include_adult: 'false' });
    const r = PersonSearchSchema.parse(await this.get(`/search/person?${params}`));
    const p = r.results[0];
    return p ? { id: p.id, name: p.name, popularity: p.popularity ?? 0, ...(p.known_for_department ? { department: p.known_for_department } : {}) } : null;
  }

  /** Filmografia (elenco e direção), mais populares primeiro. */
  async personCredits(personId: number): Promise<TmdbHit[]> {
    const c = CreditsSchema.parse(await this.get(`/person/${personId}/combined_credits?language=pt-BR`));
    const crew = (c.crew ?? []).filter((x) => x.job === 'Director');
    // aparição como "ele mesmo" (talk show, premiação, jornal) não é obra da pessoa
    const cast = (c.cast ?? []).filter(
      (x) => !SELF_CHARACTER.test(x.character ?? '') && !(x.genre_ids ?? []).some((g) => NON_WORK_TV_GENRES.has(g)),
    );
    const seen = new Set<string>();
    const out: TmdbHit[] = [];
    for (const r of [...cast, ...crew]) {
      const hit = toHit(r);
      if (!hit) continue;
      const key = `${hit.mediaType}:${hit.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
    return out.sort((a, b) => b.popularity - a.popularity);
  }

  /** Descoberta por gênero/década (só dados para ranking local; nada vai ao LLM). */
  async discover(mediaType: 'movie' | 'tv', genreIds: number[], fromYear?: number, toYear?: number): Promise<TmdbHit[]> {
    const params = new URLSearchParams({ language: 'pt-BR', include_adult: 'false', sort_by: 'popularity.desc', 'vote_count.gte': '50' });
    if (genreIds.length) params.set('with_genres', genreIds.join(','));
    const dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (fromYear) params.set(`${dateField}.gte`, `${fromYear}-01-01`);
    if (toYear) params.set(`${dateField}.lte`, `${toYear}-12-31`);
    const r = SearchSchema.parse(await this.get(`/discover/${mediaType}?${params}`));
    return r.results.map((x) => toHit({ ...x, media_type: mediaType })).filter((h): h is TmdbHit => h !== null);
  }

  /** Elenco principal (até 3) para os cards da busca. */
  async topCast(mediaType: 'movie' | 'tv', id: number): Promise<string[]> {
    const d = DetailsSchema.parse(await this.get(`/${mediaType}/${id}?language=pt-BR&append_to_response=credits`));
    return (d.credits?.cast ?? [])
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .slice(0, 3)
      .map((c) => c.name);
  }

  /** Segunda tentativa para match fraco: palavras mais longas do título, com ano e tipo. */
  private async fuzzyRetry(q: TmdbQuery, wanted: 'movie' | 'tv'): Promise<TmdbHit[]> {
    const words = [...new Set(q.title.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length >= 4))]
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    const out: TmdbHit[] = [];
    for (const w of words) {
      const params = new URLSearchParams({ query: w, language: 'pt-BR', include_adult: 'false' });
      if (q.year) params.set(wanted === 'tv' ? 'first_air_date_year' : 'year', String(q.year));
      try {
        const r = SearchSchema.parse(await this.get(`/search/${wanted}?${params}`));
        for (const x of r.results) {
          const hit = toHit({ ...x, media_type: wanted });
          if (hit) out.push(hit);
        }
      } catch {
        // tentativa extra: sem ela o match continua o da primeira busca
      }
    }
    return out;
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

function rank(pool: Map<string, TmdbHit>, q: { title: string; year?: number; mediaType: 'movie' | 'tv' }) {
  return [...pool.values()]
    .map((hit) => {
      const cand: MatchCandidate = {
        title: hit.title,
        ...(hit.originalTitle ? { originalTitle: hit.originalTitle } : {}),
        ...(hit.year ? { year: hit.year } : {}),
        mediaType: hit.mediaType,
        popularity: hit.popularity,
      };
      return { hit, score: matchScore(q, cand) };
    })
    .sort((a, b) => b.score - a.score || b.hit.popularity - a.hit.popularity);
}

function yearOf(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const y = Number(date.slice(0, 4));
  return Number.isInteger(y) && y > 1800 ? y : undefined;
}

function toHit(r: Hit): TmdbHit | null {
  if (r.media_type !== 'movie' && r.media_type !== 'tv') return null;
  const title = r.title ?? r.name;
  if (!title) return null;
  const original = r.original_title ?? r.original_name;
  const year = yearOf(r.release_date || r.first_air_date);
  return {
    tmdbId: r.id,
    mediaType: r.media_type,
    title,
    ...(original && original !== title ? { originalTitle: original } : {}),
    ...(year ? { year } : {}),
    ...(r.poster_path ? { posterUrl: `${IMG}/w342${r.poster_path}` } : {}),
    ...(r.overview ? { overview: r.overview } : {}),
    popularity: r.popularity ?? 0,
    genreIds: r.genre_ids ?? [],
    ...(r.vote_count ? { voteAverage: round1(r.vote_average ?? 0), voteCount: r.vote_count } : {}),
  };
}

function round1(n: number): number {
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
}

function baseResolution(hit: Pick<TmdbHit, 'tmdbId' | 'mediaType' | 'title' | 'year' | 'posterUrl'>): Resolution {
  return {
    provider: 'tmdb',
    externalId: `${hit.mediaType}:${hit.tmdbId}`,
    title: hit.title,
    url: `https://www.themoviedb.org/${hit.mediaType}/${hit.tmdbId}`,
    tmdbId: hit.tmdbId,
    mediaType: hit.mediaType,
    ...(hit.posterUrl ? { imageUrl: hit.posterUrl } : {}),
    ...(hit.year ? { year: hit.year } : {}),
  };
}

function detailFields(d: z.infer<typeof DetailsSchema>): Partial<Resolution> {
  const out: Partial<Resolution> = {};
  if (d.overview) out.overview = d.overview.slice(0, 4000);
  if (d.poster_path) out.imageUrl = `${IMG}/w342${d.poster_path}`;
  const runtime = d.runtime ?? d.episode_run_time?.[0];
  if (runtime && runtime > 0) out.runtimeMin = runtime;
  if (d.genres?.length) out.genreIds = d.genres.map((g) => g.id);
  if (d.vote_count) {
    out.voteAverage = round1(d.vote_average ?? 0);
    out.voteCount = d.vote_count;
  }
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
