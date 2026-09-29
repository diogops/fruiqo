import type { Resolution } from '@fruiqo/contracts';
import { genresFromSubjects } from '@fruiqo/taxonomy';
import { z } from 'zod';
import type { BookAlternativeRow } from '../../db/schema.js';
import type { ExtractedItem } from '../extractors/types.js';
import { SafeFetchError, safeFetchJson, type SafeFetchOptions } from '../safe-fetch.js';
import { similarity, STRONG_MATCH } from './match.js';

// RF-48 (D-21): livros pela Open Library. Sem chave; User-Agent identificado (TOS-REQ-60); até
// 3 req/s por processo; sem crawl/bulk de capas (TOS-REQ-61: só a URL pública vai para a tela);
// cache de 30 dias (TOS-REQ-62, purga em 0012). Capa nunca vai ao LLM (TOS-REQ-66, ARB-REQ-06).

const API = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org/b/id';
// `editions*` + `lang=pt`: a Open Library devolve, por obra, a edição que melhor casa com a busca,
// preferindo português ("Nineteen Eighty-Four" → edição "1984"; "Le petit prince" → "O pequeno príncipe")
const SEARCH_FIELDS =
  'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,edition_count,editions,editions.title,editions.language';

const Doc = z.object({
  key: z.string(),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  cover_i: z.number().int().optional(),
  number_of_pages_median: z.number().int().optional(),
  subject: z.array(z.string()).optional(),
  edition_count: z.number().int().optional(),
  editions: z.object({ docs: z.array(z.object({ title: z.string().optional(), language: z.array(z.string()).optional() })) }).optional(),
});
type Doc = z.infer<typeof Doc>;
const SearchSchema = z.object({ docs: z.array(Doc) });

const WorkSchema = z.object({
  title: z.string().optional(),
  description: z.union([z.string(), z.object({ value: z.string() })]).optional(),
  subjects: z.array(z.string()).optional(),
});
const EditionsSchema = z.object({
  entries: z.array(
    z.object({
      title: z.string().optional(),
      languages: z.array(z.object({ key: z.string() })).optional(),
      covers: z.array(z.number().int()).optional(),
    }),
  ),
});

export interface BookQuery {
  title: string;
  author?: string;
  year?: number;
}

export interface BookHit {
  olWorkId: string;
  /** título da obra (costuma ser o original) */
  title: string;
  /** título da edição em português, quando a busca trouxe uma */
  ptTitle?: string;
  authors: string[];
  year?: number;
  coverUrl?: string;
  pages?: number;
  subjects: string[];
  editionCount: number;
}

export interface DetailedBookResolution {
  resolution: Resolution | null;
  score: number | null;
  alternatives: BookAlternativeRow[];
}

const MAX_ALTERNATIVES = 3;
const MIN_ALTERNATIVE_SCORE = 0.3;
const MIN_LOOKUP_SCORE = 0.6;
/** conexão que trava/cai ou 5xx: até 2 novas tentativas (a Open Library oscila) */
const RETRIES = 2;
/** 3 req/s (TOS-REQ-60 com User-Agent identificado): um pedido a cada ~340 ms por processo */
const MIN_INTERVAL_MS = 340;

let nextSlot = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class OpenLibraryResolver {
  private readonly userAgent: string;

  constructor(
    contact: string | undefined,
    private readonly fetchImpl?: SafeFetchOptions['fetchImpl'],
    /** testes/eval em mock: sem espera entre chamadas */
    private readonly throttled = true,
  ) {
    this.userAgent = `Fruiqo/0.1 (${contact?.trim() || 'https://github.com/diogops/fruiqo'})`;
  }

  supports(item: ExtractedItem): boolean {
    return item.kind === 'book';
  }

  async resolve(item: ExtractedItem): Promise<Resolution | null> {
    return (await this.resolveDetailed(item)).resolution;
  }

  resolveDetailed(item: ExtractedItem): Promise<DetailedBookResolution> {
    return this.lookupDetailed({ title: item.title, ...(item.creator ? { author: item.creator } : {}), ...(item.year ? { year: item.year } : {}) });
  }

  /** Enriquecimento de um título já catalogado: só aceita correspondência razoável. */
  async lookup(q: BookQuery): Promise<Resolution | null> {
    const d = await this.lookupDetailed(q);
    return d.score != null && d.score >= MIN_LOOKUP_SCORE ? d.resolution : null;
  }

  /**
   * Busca pelo título (e autor, se houver) com preferência por edição em português, pontua
   * título/autor/ano/edições e detalha o melhor. Sem resultado: tenta só pelo campo título.
   */
  async lookupDetailed(q: BookQuery): Promise<DetailedBookResolution> {
    const params = new URLSearchParams({ q: q.title, lang: 'pt', limit: '10', fields: SEARCH_FIELDS });
    if (q.author) params.set('author', q.author);
    let hits = (await this.search(params)).map(toHit);
    if (hits.length === 0) {
      const loose = new URLSearchParams({ title: q.title, lang: 'pt', limit: '10', fields: SEARCH_FIELDS });
      hits = (await this.search(loose).catch(() => [])).map(toHit);
    }
    const ranked = hits
      .map((hit) => ({ hit, score: bookScore(q, hit) }))
      .sort((a, b) => b.score - a.score || b.hit.editionCount - a.hit.editionCount);
    const best = ranked[0];
    if (!best) return { resolution: null, score: null, alternatives: [] };
    const alternatives: BookAlternativeRow[] = ranked
      .slice(1)
      .filter((r) => r.score >= MIN_ALTERNATIVE_SCORE)
      .slice(0, MAX_ALTERNATIVES)
      .map(({ hit, score }) => ({
        provider: 'openlibrary',
        olWorkId: hit.olWorkId,
        title: displayTitle(hit),
        ...(hit.authors.length ? { authors: hit.authors.slice(0, 3) } : {}),
        ...(hit.year ? { year: hit.year } : {}),
        ...(hit.coverUrl ? { coverUrl: hit.coverUrl } : {}),
        score,
      }));
    const resolution = await this.detail(best.hit);
    // título PT-BR achado só no detalhe (edições) também conta para a nota
    const score = Math.max(best.score, bookScore(q, { ...best.hit, ptTitle: resolution.title }));
    return { resolution, score, alternatives };
  }

  /** Obra escolhida (alternativa na revisão, import da busca). */
  async byWorkId(olWorkId: string, hint?: BookHit): Promise<Resolution | null> {
    if (!/^OL\d+W$/.test(olWorkId)) return null;
    if (hint) return this.detail(hint);
    // a busca por chave traz autores, ano, capa e páginas (o works/<id>.json só tem links de autor)
    const byKey = await this.search(new URLSearchParams({ q: `key:/works/${olWorkId}`, lang: 'pt', limit: '1', fields: SEARCH_FIELDS })).catch(() => []);
    const hit = byKey.map(toHit).find((h) => h.olWorkId === olWorkId);
    if (hit) return this.detail(hit);
    try {
      const w = WorkSchema.parse(await this.get(`/works/${olWorkId}.json`));
      if (!w.title) return null;
      return this.detail({ olWorkId, title: w.title, authors: [], subjects: w.subjects ?? [], editionCount: 0 }, w);
    } catch {
      return null;
    }
  }

  /** RF-46: busca livre (título ou autor), na ordem de relevância da Open Library; título em PT-BR quando houver. */
  async searchBooks(query: string, limit = 8): Promise<BookHit[]> {
    const docs = await this.search(new URLSearchParams({ q: query, lang: 'pt', limit: String(limit), fields: SEARCH_FIELDS }));
    return docs.map(toHit);
  }

  /** Detalhes: sinopse (works) e título da edição em português, quando houver. Falhas são ignoradas. */
  private async detail(hit: BookHit, work?: z.infer<typeof WorkSchema>): Promise<Resolution> {
    let overview: string | undefined;
    let ptTitle = hit.ptTitle;
    let subjects = hit.subjects;
    try {
      const w = work ?? WorkSchema.parse(await this.get(`/works/${hit.olWorkId}.json`));
      const d = typeof w.description === 'string' ? w.description : w.description?.value;
      if (d) overview = d.replace(/\r\n/g, '\n').slice(0, 4000);
      if (subjects.length === 0 && w.subjects) subjects = w.subjects;
    } catch {
      // sinopse é opcional
    }
    // a busca não trouxe edição em português (ou é uma alternativa guardada): procura nas edições
    if (!ptTitle) {
      try {
        const e = EditionsSchema.parse(await this.get(`/works/${hit.olWorkId}/editions.json?limit=50`));
        ptTitle = e.entries.find((x) => x.title && x.languages?.some((l) => l.key === '/languages/por'))?.title;
      } catch {
        // título em PT-BR é opcional (o da obra vale)
      }
    }
    const title = ptTitle ?? hit.title;
    return {
      provider: 'openlibrary',
      externalId: `ol:${hit.olWorkId}`,
      title,
      url: `${API}/works/${hit.olWorkId}`,
      olWorkId: hit.olWorkId,
      ...(hit.coverUrl ? { imageUrl: hit.coverUrl } : {}),
      ...(hit.year ? { year: hit.year } : {}),
      ...(hit.authors.length ? { authors: hit.authors.slice(0, 10) } : {}),
      ...(hit.pages ? { pages: hit.pages } : {}),
      ...(subjects.length ? { subjects: subjects.slice(0, 30).map((s) => s.slice(0, 120)) } : {}),
      ...(overview ? { overview } : {}),
    };
  }

  private async search(params: URLSearchParams): Promise<Doc[]> {
    return SearchSchema.parse(await this.get(`/search.json?${params}`)).docs;
  }

  private async get(path: string): Promise<unknown> {
    // edições de obra popular passam de 256 KB; a Open Library costuma ser mais lenta que o TMDB
    const once = async () => {
      if (this.throttled) await throttle();
      return safeFetchJson(`${API}${path}`, { headers: { 'user-agent': this.userAgent }, fetchImpl: this.fetchImpl, maxBytes: 1024 * 1024, timeoutMs: 10_000 });
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return await once();
      } catch (err) {
        // 4xx e mock sem gravação não repetem
        if (attempt >= RETRIES || !transient(err)) throw err;
      }
    }
  }
}

function transient(err: unknown): boolean {
  if (err instanceof SafeFetchError) return (err.status ?? 0) >= 500;
  const name = (err as Error | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError' || err instanceof TypeError;
}

/** Gêneros da taxonomia a partir dos assuntos (CC0) de uma resolução de livro. */
export function bookGenres(res: Resolution): string[] {
  return genresFromSubjects(res.subjects ?? []);
}

function toHit(d: Doc): BookHit {
  const olWorkId = d.key.replace(/^\/works\//, '');
  const pt = d.editions?.docs.find((e) => e.title && e.language?.includes('por'))?.title;
  return {
    olWorkId,
    title: d.title,
    ...(pt && pt !== d.title ? { ptTitle: pt } : {}),
    authors: d.author_name ?? [],
    ...(d.first_publish_year ? { year: d.first_publish_year } : {}),
    ...(d.cover_i ? { coverUrl: `${COVERS}/${d.cover_i}-M.jpg` } : {}),
    ...(d.number_of_pages_median ? { pages: d.number_of_pages_median } : {}),
    subjects: d.subject ?? [],
    editionCount: d.edition_count ?? 0,
  };
}

/** Título para mostrar: o da edição em português, se houver. */
export function displayTitle(h: BookHit): string {
  return h.ptTitle ?? h.title;
}

/**
 * Aderência do livro ao texto: título (65%, o melhor entre o da obra e o da edição em português),
 * autor (20%, quando informado), ano da 1ª publicação ±1 (10%) e edições (5%: entre obras de mesmo
 * título, a canônica com centenas de edições ganha da duplicata com uma).
 */
export function bookScore(q: BookQuery, h: BookHit): number {
  const sim = Math.max(similarity(q.title, h.title), h.ptTitle ? similarity(q.title, h.ptTitle) : 0);
  let authorScore = 0.6;
  if (q.author) authorScore = Math.max(0, ...h.authors.map((a) => similarity(q.author!, a)));
  let yearScore = 0.6;
  if (q.year && h.year) yearScore = Math.abs(q.year - h.year) <= 1 ? 1 : 0.2;
  const popularity = Math.min(1, Math.log10(h.editionCount + 1) / 3);
  const score = 0.65 * sim + 0.2 * authorScore + 0.1 * yearScore + 0.05 * popularity;
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}

export { STRONG_MATCH };
