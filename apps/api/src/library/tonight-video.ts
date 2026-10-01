// D-25: filme/série no "O que assistir hoje?". O servidor encontra as obras elegíveis e a IA (quando
// usada) só interpretou o pedido. Fontes, nesta ordem:
//   1) Minha Área (Quero assistir / Assistindo), na ordem da fila: o que você já escolheu vem primeiro;
//   2) descobertas no /discover do TMDB: seus streamings, gêneros do plano (todos / algum / nenhum),
//      palavras-chave dos atributos ("faz pensar" → philosophy, artificial intelligence...), mais
//      recentes e mais bem avaliados, em páginas com cursor (o estoque é reposto quando acaba).
// O histórico inteiro fica no banco (exclusão por ID); nada disso vai para a IA. Pontuação local:
// aderência ao pedido, gosto, qualidade ajustada por votos e novidade. O motivo só cita evidência.
import type { TitleSearchResult } from '@fruiqo/contracts';
import { GENRES, type GenreKey, genresFromTmdb } from '@fruiqo/taxonomy';
import type { TmdbHit, TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { isAnime } from '../pipeline/resolvers/tmdb.js';
import { tmdbGenreIds } from './search-query.js';
import { ATTRIBUTES, type Attr, type TonightPlan } from './tonight-plan.js';

export const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));

export type Source = 'list' | 'best' | 'theme' | 'recent' | 'ai';

export interface Candidate {
  item: TitleSearchResult;
  source: Source;
  /** página de onde veio (novidade: páginas mais fundas valem mais) */
  page: number;
  anime: boolean;
  genres: GenreKey[];
  /** atributos do plano que a fonte comprova (veio da busca por palavra-chave deles) */
  themes: Attr[];
  /** compatibilidade com o pedido (0..1) */
  fit: number;
  /** compatibilidade com o perfil (0..1) */
  profile: number;
  /** desempate: qualidade ajustada por votos e novidade */
  score: number;
}

/** "a, b e c" */
export function joinPt(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

export function hitGenres(h: Pick<TmdbHit, 'genreIds' | 'mediaType'>): GenreKey[] {
  return Object.keys(genresFromTmdb(h.genreIds, h.mediaType)) as GenreKey[];
}

/** O plano aceita a obra? (gêneros obrigatórios, alternativas e exclusões) */
export function planAccepts(plan: TonightPlan, genres: GenreKey[]): boolean {
  if (plan.genresNone.some((g) => genres.includes(g))) return false;
  if (plan.genresAll.some((g) => !genres.includes(g))) return false;
  if (plan.genresAny.length && !plan.genresAny.some((g) => genres.includes(g))) return false;
  return true;
}

/** Nota geral com pouco voto puxada para a média (não deixa 9,0 de 30 votos vencer). */
export function adjustedQuality(avg?: number, votes?: number): number {
  if (avg == null || !votes) return 0.5;
  const m = 500;
  const prior = 6.5;
  return ((votes * avg + m * prior) / (votes + m)) / 10;
}

/**
 * Índice de compatibilidade com o PEDIDO (0..1): gêneros pedidos, tema comprovado (veio da busca por
 * palavra-chave do atributo) e época. Sem pedido, todos empatam (1) e quem decide é o perfil.
 * Requisitos obrigatórios já foram filtrados antes: aqui é o grau.
 */
export function searchFit(c: Omit<Candidate, 'score' | 'fit' | 'profile'>, plan: TonightPlan): number {
  const parts: number[] = [];
  if (plan.genresAll.length) parts.push(plan.genresAll.filter((g) => c.genres.includes(g)).length / plan.genresAll.length);
  else if (plan.genresAny.length) parts.push(Math.min(1, plan.genresAny.filter((g) => c.genres.includes(g)).length / Math.min(2, plan.genresAny.length)));
  // sugestão da IA para o texto: tema provável, não comprovado
  if (plan.prefer.length) parts.push(c.source === 'ai' ? 0.6 : plan.prefer.filter((a) => c.themes.includes(a)).length / plan.prefer.length);
  if (plan.decade) parts.push(c.item.year && c.item.year >= plan.decade && c.item.year < plan.decade + 10 ? 1 : 0);
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 1;
}

/** Índice de compatibilidade com o PERFIL (0..1): a nota automática (níveis, subgêneros, favoritos, resumo, notas). */
export function profileFit(c: Omit<Candidate, 'score' | 'fit' | 'profile'>): number {
  return c.item.autoRating != null ? c.item.autoRating / 5 : 0.5;
}

/** Desempate depois do pedido e do perfil: qualidade ajustada por votos e um pouco de novidade. */
export function scoreCandidate(c: Omit<Candidate, 'score' | 'fit' | 'profile'>): number {
  const quality = adjustedQuality(c.item.generalRating, c.item.generalVotes);
  const novelty = c.source === 'recent' ? 1 : Math.min(1, 0.5 + 0.2 * (c.page - 1));
  return 0.7 * quality + 0.3 * novelty;
}

/** Candidato com os dois índices e o desempate. */
export function rate(c: Omit<Candidate, 'score' | 'fit' | 'profile'>, plan: TonightPlan): Candidate {
  return { ...c, fit: searchFit(c, plan), profile: profileFit(c), score: scoreCandidate(c) };
}

/**
 * Ordem: Minha Área primeiro (fila); depois, pelo grau de compatibilidade com o PEDIDO (em faixas de
 * 10%), depois com o PERFIL (faixas de 5%), e só então qualidade/novidade. Na Minha Área, o pedido
 * e depois a ordem da sua fila.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const listA = a.source === 'list' ? 1 : 0;
  const listB = b.source === 'list' ? 1 : 0;
  if (listA !== listB) return listB - listA;
  const fit = Math.round(b.fit * 10) - Math.round(a.fit * 10);
  if (fit) return fit;
  if (listA) return 0; // mesma faixa de pedido: mantém a ordem da sua fila
  return Math.round(b.profile * 20) - Math.round(a.profile * 20) || b.score - a.score;
}

/** Motivo só com evidência conferida (lista, gêneros, tema, nota, gosto). */
export function reasonFor(c: Omit<Candidate, 'score' | 'fit' | 'profile'>, plan: TonightPlan): string {
  const parts: string[] = [];
  if (c.source === 'list') parts.push('Na sua lista');
  if (c.source === 'ai') parts.push('Sugestão da IA para o seu pedido');
  const asked = [...plan.genresAll, ...plan.genresAny].filter((g) => c.genres.includes(g));
  if (asked.length) parts.push(joinPt(asked.map((g) => GENRE_LABEL.get(g)!.toLowerCase())));
  if (c.themes.length) parts.push(`tema: ${joinPt(c.themes.map((a) => ATTRIBUTES[a].label))}`);
  if (c.item.generalRating != null && (c.item.generalVotes ?? 0) >= 100) parts.push(`nota ${c.item.generalRating.toFixed(1).replace('.', ',')} no TMDB`);
  if ((c.item.autoRating ?? 0) >= 4) parts.push('combina com o seu gosto');
  const text = parts.join(' · ') || 'Bem avaliado e disponível para você';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface DiscoverQuery {
  media: 'movie' | 'tv';
  source: Exclude<Source, 'list' | 'ai'>;
  page: number;
  themes: Attr[];
}

/**
 * Parâmetros do /discover para uma fonte do plano. null = esse tipo não atende ao plano (ex.:
 * gênero pedido sem equivalente em série).
 */
export function discoverParams(
  q: DiscoverQuery,
  plan: TonightPlan,
  opts: { providerIds: number[]; keywordIds: number[]; softGenres: GenreKey[] },
): Parameters<TmdbResolver['discoverBrowse']>[1] | null {
  const ids = (gs: GenreKey[]) => tmdbGenreIds(gs, q.media);
  if (plan.genresAll.some((g) => ids([g]).length === 0)) return null;
  if (plan.genresAny.length && ids(plan.genresAny).length === 0) return null;
  if (q.source === 'theme' && opts.keywordIds.length === 0) return null;
  const all = ids(plan.genresAll);
  const any = ids(plan.genresAny);
  // sem gênero no pedido: os de que você gosta (qualquer um) só na fonte "best"
  const soft = !all.length && !any.length && q.source === 'best' ? ids(opts.softGenres) : [];
  const genreIds = all.length ? all : any.length ? any : soft;
  const decade = plan.decade ? { fromDate: `${plan.decade}-01-01`, toDate: `${plan.decade + 9}-12-31` } : {};
  return {
    sort: q.source === 'recent' ? 'newest' : 'best',
    page: q.page,
    ...(opts.providerIds.length ? { providerIds: opts.providerIds } : { availableBR: true }),
    ...(genreIds.length ? { genreIds, anyGenre: !all.length } : {}),
    ...(plan.genresNone.length ? { withoutGenreIds: ids(plan.genresNone) } : {}),
    ...(q.source === 'theme' ? { keywordIds: opts.keywordIds } : {}),
    // recentes: com algum voto, para não trazer lançamento sem avaliação nenhuma
    ...(q.source === 'recent' ? { minVotes: 50 } : {}),
    ...decade,
  };
}

/**
 * Franquia aproximada pelo título: o nome antes de ":" / " - ", sem número de sequência no fim
 * ("Planeta dos Macacos: O Confronto" e "...: A Origem" → "planeta dos macacos"; "Mad Max 2" → "mad max").
 * Um título por franquia em cada lote; os outros ficam para "Novas sugestões".
 */
export function franchiseKey(title: string): string {
  const head = title.split(/\s*[:–—]\s*|\s+-\s+/)[0] ?? title;
  return head
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+(\d{1,2}|i{1,3}|iv|v|parte \d+)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plano + gênero escolhido na tela: o gênero do select entra como obrigatório se o texto não o cobriu. */
export function withSelectedGenre(plan: TonightPlan, genre?: GenreKey): TonightPlan {
  if (!genre || plan.genresAll.includes(genre) || plan.genresAny.includes(genre) || plan.genresNone.includes(genre)) return plan;
  return { ...plan, genresAll: [...plan.genresAll, genre] };
}

export { isAnime };
