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
import { ATTRIBUTES, type Attr, ORIGINS, originCountries, requiredAttrs, type TonightPlan } from './tonight-plan.js';

/** O plano pede duração máxima (filmes)? */
export function planMaxRuntime(plan: TonightPlan): number | undefined {
  const m = Math.min(...plan.prefer.map((a) => (ATTRIBUTES[a] as { maxRuntime?: number }).maxRuntime ?? Infinity));
  return Number.isFinite(m) ? m : undefined;
}

export const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));

export type Source = 'list' | 'best' | 'theme' | 'recent' | 'ai' | 'similar';

export interface Candidate {
  item: TitleSearchResult;
  source: Source;
  /** página de onde veio (novidade: páginas mais fundas valem mais) */
  page: number;
  anime: boolean;
  genres: GenreKey[];
  /** atributos do plano que a fonte comprova (veio da busca por palavra-chave deles) */
  themes: Attr[];
  /** veio de uma busca com a duração máxima pedida ("curto") */
  runtimeOk?: boolean;
  /** origem pedida comprovada (busca por país de origem ou país da obra conferido) */
  originOk?: boolean;
  /** veio das recomendações/semelhantes desta obra de referência ("igual a X") */
  similarTo?: string;
  /** "mesma pegada de X": nota de semelhança com X (tonight-reference.ts); quando existe, ordena por ela */
  refScore?: number;
  /** compatibilidade com o pedido (0..1) */
  fit: number;
  /** compatibilidade com o perfil (0..1) */
  profile: number;
  /** "mais assistidos" (0..1): quanta gente viu, pelos votos no TMDB */
  popular: number;
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
export function searchFit(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>, plan: TonightPlan): number {
  const parts: number[] = [];
  if (plan.genresAll.length) parts.push(plan.genresAll.filter((g) => c.genres.includes(g)).length / plan.genresAll.length);
  else if (plan.genresAny.length) parts.push(Math.min(1, plan.genresAny.filter((g) => c.genres.includes(g)).length / Math.min(2, plan.genresAny.length)));
  // sugestão da IA para o texto: tema provável, não comprovado
  if (plan.prefer.length) {
    // por atributo: palavra-chave comprovada (1) > duração dentro do pedido (1) > pista de gênero (0,6) > IA (0,6)
    const per: number[] = plan.prefer.map((a) => {
      if (c.themes.includes(a)) return 1;
      const def = ATTRIBUTES[a] as { like: readonly GenreKey[]; maxRuntime?: number };
      if (def.maxRuntime && c.runtimeOk) return 1;
      if (def.like.some((g) => c.genres.includes(g))) return 0.6;
      return c.source === 'ai' ? 0.6 : 0;
    });
    parts.push(per.reduce((x, y) => x + y, 0) / per.length);
  }
  if (plan.decade) parts.push(c.item.year && c.item.year >= plan.decade && c.item.year < plan.decade + 10 ? 1 : 0);
  // "igual a X": a IA compara a premissa (1); as recomendações do TMDB vêm logo atrás (0,9)
  if (plan.references?.length) parts.push(c.source === 'ai' ? 1 : c.similarTo ? 0.9 : 0);
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 1;
}

/** Índice de compatibilidade com o PERFIL (0..1): a nota automática (níveis, subgêneros, favoritos, resumo, notas). */
export function profileFit(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>): number {
  return c.item.autoRating != null ? c.item.autoRating / 5 : 0.5;
}

/** votos a partir dos quais a obra conta como das mais assistidas (índice 1) */
const POPULAR_VOTES = 20_000;

/**
 * Índice de "mais assistidos" (0..1): votos no TMDB em escala log (quem avalia viu). 10 votos ≈ 0,24;
 * 1 mil ≈ 0,7; 20 mil ou mais = 1. Sem votos, 0.
 */
export function popularFit(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>): number {
  const v = c.item.generalVotes ?? 0;
  return v > 0 ? Math.min(1, Math.log10(1 + v) / Math.log10(1 + POPULAR_VOTES)) : 0;
}

/** Desempate depois do pedido e do perfil: qualidade ajustada por votos e um pouco de novidade. */
export function scoreCandidate(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>): number {
  const quality = adjustedQuality(c.item.generalRating, c.item.generalVotes);
  const novelty = c.source === 'recent' ? 1 : Math.min(1, 0.5 + 0.2 * (c.page - 1));
  return 0.7 * quality + 0.3 * novelty;
}

/** Candidato com os dois índices e o desempate. */
export function rate(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>, plan: TonightPlan): Candidate {
  return { ...c, fit: searchFit(c, plan), popular: popularFit(c), profile: profileFit(c), score: scoreCandidate(c) };
}

/**
 * Ordem: Minha Área primeiro (fila); depois três índices, nesta ordem: compatibilidade com o PEDIDO
 * (faixas de 10%), MAIS ASSISTIDOS (faixas de 10%) e compatibilidade com o PERFIL (faixas de 5%); só
 * então qualidade/novidade. Na Minha Área, o pedido e depois a ordem da sua fila.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const listA = a.source === 'list' ? 1 : 0;
  const listB = b.source === 'list' ? 1 : 0;
  if (listA !== listB) return listB - listA;
  if (!listA && (a.refScore != null || b.refScore != null)) return (b.refScore ?? -1) - (a.refScore ?? -1);
  const fit = Math.round(b.fit * 10) - Math.round(a.fit * 10);
  if (fit) return fit;
  if (listA) return 0; // mesma faixa de pedido: mantém a ordem da sua fila
  return Math.round(b.popular * 10) - Math.round(a.popular * 10) || Math.round(b.profile * 20) - Math.round(a.profile * 20) || b.score - a.score;
}

/** Motivo só com evidência conferida (lista, gêneros, tema, nota, gosto). */
export function reasonFor(c: Omit<Candidate, 'score' | 'fit' | 'profile' | 'popular'>, plan: TonightPlan): string {
  const parts: string[] = [];
  if (c.source === 'list') parts.push('Na sua lista');
  if (c.source === 'ai') parts.push(plan.references?.length ? `Sugestão da IA: na linha de ${plan.references.join(' e ')}` : 'Sugestão da IA para o seu pedido');
  if (c.similarTo) parts.push(`Parecido com ${c.similarTo}`);
  const asked = [...plan.genresAll, ...plan.genresAny].filter((g) => c.genres.includes(g));
  if (asked.length) parts.push(joinPt(asked.map((g) => GENRE_LABEL.get(g)!.toLowerCase())));
  // só o que foi comprovado: palavra-chave do TMDB (tema) ou duração dentro do pedido. Gênero
  // parecido não prova atributo ("drama" não é "história real" nem "faz pensar")
  if (c.themes.length) parts.push(`tema: ${joinPt(c.themes.map((a) => ATTRIBUTES[a].label))}`);
  const timed = plan.prefer.filter((a) => (ATTRIBUTES[a] as { maxRuntime?: number }).maxRuntime && c.runtimeOk && !c.themes.includes(a));
  if (timed.length) parts.push(joinPt(timed.map((a) => ATTRIBUTES[a].label)));
  if (c.originOk && plan.origins?.length) parts.push(plan.origins.map((o) => ORIGINS[o].label).join(' ou '));
  if (c.item.generalRating != null && (c.item.generalVotes ?? 0) >= 100) parts.push(`nota ${c.item.generalRating.toFixed(1).replace('.', ',')} no TMDB`);
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
  opts: { providerIds: number[]; keywordIds: number[]; softGenres: GenreKey[]; requiredKeywordIds?: number[] },
): Parameters<TmdbResolver['discoverBrowse']>[1] | null {
  const ids = (gs: GenreKey[]) => tmdbGenreIds(gs, q.media);
  // atributo obrigatório ("história real"): toda fonte busca só obras com a palavra-chave dele; sem o
  // ID da palavra-chave não há como provar, então não busca. A fonte "theme" vira a mesma coisa: sai
  const required = requiredAttrs(plan).length > 0;
  if (required && (!opts.requiredKeywordIds?.length || q.source === 'theme')) return null;
  if (plan.genresAll.some((g) => ids([g]).length === 0)) return null;
  if (plan.genresAny.length && ids(plan.genresAny).length === 0) return null;
  if (q.source === 'theme' && opts.keywordIds.length === 0) return null;
  const all = ids(plan.genresAll);
  const any = ids(plan.genresAny);
  // sem gênero no pedido: pista dos atributos ("leve" → comédia, família...) ou, sem ela, os de que
  // você gosta (qualquer um), só na fonte "best"
  const hint = [...new Set(plan.prefer.flatMap((a) => [...(ATTRIBUTES[a] as { like: readonly GenreKey[] }).like]))];
  const soft = !all.length && !any.length && q.source !== 'theme' ? (hint.length ? ids(hint) : q.source === 'best' ? ids(opts.softGenres) : []) : [];
  // o que o atributo pede para evitar ("leve" → sem terror/guerra) sai da busca
  const avoid = [...new Set([...plan.genresNone, ...plan.prefer.flatMap((a) => [...(ATTRIBUTES[a] as { avoid: readonly GenreKey[] }).avoid])])].filter(
    (g) => !plan.genresAll.includes(g) && !plan.genresAny.includes(g),
  );
  const maxRuntime = q.media === 'movie' ? Math.min(...plan.prefer.map((a) => (ATTRIBUTES[a] as { maxRuntime?: number }).maxRuntime ?? Infinity)) : Infinity;
  // fonte "theme": o atributo pode exigir gênero junto com a palavra-chave ("pra chorar" → drama)
  const themeGenres = q.source === 'theme' ? ids([...new Set(plan.prefer.flatMap((a) => [...((ATTRIBUTES[a] as { themeGenres?: readonly GenreKey[] }).themeGenres ?? [])]))]) : [];
  const genreIds = all.length ? all : any.length ? any : themeGenres.length ? themeGenres : soft;
  const decade = plan.decade ? { fromDate: `${plan.decade}-01-01`, toDate: `${plan.decade + 9}-12-31` } : {};
  return {
    sort: q.source === 'recent' ? 'newest' : 'best',
    page: q.page,
    ...(opts.providerIds.length ? { providerIds: opts.providerIds } : { availableBR: true }),
    ...(genreIds.length ? { genreIds, anyGenre: !all.length } : {}),
    ...(avoid.length ? { withoutGenreIds: ids(avoid) } : {}),
    ...(required ? { keywordIds: opts.requiredKeywordIds! } : q.source === 'theme' ? { keywordIds: opts.keywordIds } : {}),
    ...(Number.isFinite(maxRuntime) ? { maxRuntime } : {}),
    ...(originCountries(plan).length ? { originCountries: originCountries(plan) } : {}),
    // recentes: com votos suficientes (lançamento sem avaliação não toma vaga); tema: o conjunto com a
    // palavra-chave é pequeno, então aceita obras menos votadas
    ...(q.source === 'recent' ? { minVotes: 200 } : q.source === 'theme' ? { minVotes: 300 } : {}),
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
