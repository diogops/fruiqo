import type { StreamingLinkKey } from '@fruiqo/contracts';
import { z } from 'zod';
import { safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';

/**
 * D-22: link direto para o título em cada serviço de streaming, a partir dos IDs que o Wikidata
 * (dados CC0, API pública) guarda por título, ligados ao ID do TMDB. Uma consulta SPARQL por título,
 * só no enriquecimento, pelo `fetchImpl` do PipelineGateway (no mock não há gravação: sai sem links).
 * O que vai ao Wikidata é só o ID numérico do TMDB; nada disso vai ao LLM (ARB-REQ-06).
 */
const SPARQL = 'https://query.wikidata.org/sparql';

/** propriedade do Wikidata → serviço, formato do ID e modelo da página pública do título */
interface LinkRule {
  prop: string;
  key: StreamingLinkKey;
  id: RegExp;
  url: (id: string) => string;
}

const MOVIE_RULES: LinkRule[] = [
  { prop: 'P1874', key: 'netflix', id: /^\d{5,12}$/, url: (id) => `https://www.netflix.com/br/title/${id}` },
  { prop: 'P14440', key: 'prime_video', id: /^[A-Za-z0-9._-]{6,80}$/, url: (id) => `https://www.primevideo.com/detail/${id}` },
  { prop: 'P8055', key: 'prime_video', id: /^[A-Za-z0-9._-]{6,80}$/, url: (id) => `https://www.primevideo.com/detail/${id}` },
  { prop: 'P7595', key: 'disney_plus', id: /^[A-Za-z0-9]{6,40}$/, url: (id) => `https://www.disneyplus.com/pt-br/movies/wd/${id}` },
  { prop: 'P8298', key: 'max', id: /^(movie|feature|show|series)\/[A-Za-z0-9:_-]{6,80}$/, url: (id) => `https://play.hbomax.com/${id}` },
  { prop: 'P9586', key: 'apple_tv', id: /^umc\.cmc\.[a-z0-9]{10,40}$/, url: (id) => `https://tv.apple.com/br/movie/${id}` },
  { prop: 'P12356', key: 'globoplay', id: /^[A-Za-z0-9]{4,40}$/, url: (id) => `https://globoplay.globo.com/-/t/${id}/` },
  { prop: 'P7299', key: 'mubi', id: /^\d{1,10}$/, url: (id) => `https://mubi.com/pt/br/films/${id}` },
];

const TV_RULES: LinkRule[] = [
  ...MOVIE_RULES.filter((r) => !['P7595', 'P9586', 'P7299'].includes(r.prop)),
  { prop: 'P7596', key: 'disney_plus', id: /^[A-Za-z0-9]{6,40}$/, url: (id) => `https://www.disneyplus.com/pt-br/series/wp/${id}` },
  { prop: 'P9751', key: 'apple_tv', id: /^umc\.cmc\.[a-z0-9]{10,40}$/, url: (id) => `https://tv.apple.com/br/show/${id}` },
  { prop: 'P11330', key: 'crunchyroll', id: /^[A-Za-z0-9]{6,20}$/, url: (id) => `https://www.crunchyroll.com/pt-br/series/${id}` },
];

const Bindings = z.object({
  results: z.object({
    bindings: z.array(z.record(z.string(), z.object({ value: z.string() }))),
  }),
});

export type TitleLinks = Partial<Record<StreamingLinkKey, string>>;

export function buildQuery(mediaType: 'movie' | 'tv', tmdbId: number): string {
  const tmdbProp = mediaType === 'movie' ? 'P4947' : 'P4983';
  const rules = mediaType === 'movie' ? MOVIE_RULES : TV_RULES;
  const vars = rules.map((r) => `OPTIONAL { ?item wdt:${r.prop} ?${r.prop} . }`).join(' ');
  return `SELECT * WHERE { ?item wdt:${tmdbProp} "${Math.trunc(tmdbId)}" . ${vars} } LIMIT 5`;
}

/** Converte a resposta do SPARQL nos links; ID fora do formato esperado é ignorado. */
export function linksFromBindings(mediaType: 'movie' | 'tv', body: unknown): TitleLinks {
  const parsed = Bindings.safeParse(body);
  if (!parsed.success) return {};
  const rules = mediaType === 'movie' ? MOVIE_RULES : TV_RULES;
  const out: TitleLinks = {};
  for (const row of parsed.data.results.bindings) {
    for (const r of rules) {
      const id = row[r.prop]?.value?.trim();
      if (!id || out[r.key] || !r.id.test(id)) continue;
      out[r.key] = r.url(id);
    }
  }
  return out;
}

export async function fetchTitleLinks(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  fetchImpl?: SafeFetchOptions['fetchImpl'],
): Promise<TitleLinks> {
  try {
    const url = `${SPARQL}?${new URLSearchParams({ query: buildQuery(mediaType, tmdbId), format: 'json' })}`;
    const body = await safeFetchJson(url, {
      // política de uso da Wikimedia: User-Agent identificável com contato
      headers: { accept: 'application/sparql-results+json', 'user-agent': 'Fruiqo/0.1 (https://github.com/diogops/fruiqo)' },
      fetchImpl,
    });
    return linksFromBindings(mediaType, body);
  } catch {
    // opcional: sem Wikidata o app cai para a busca/página inicial do serviço
    return {};
  }
}
