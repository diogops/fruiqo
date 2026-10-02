// "Com a mesma pegada de X": candidatos já dentro dos seus streamings (palavras-chave de X com peso
// por especificidade, quem fez X, recomendações do TMDB) somados às sugestões da IA, e uma nota de
// semelhança local. Tudo aqui é puro (sem rede): o serviço busca os dados e chama estas funções.
// Base: consulta de 2026-10-02 (reports/consulta-busca-referencia-2026-10-02.md).

/** palavras-chave de cadastro, não de enredo: não contam na semelhança */
const META_KEYWORDS = new Set([
  'woman director',
  'duringcreditsstinger',
  'aftercreditsstinger',
  'based on novel or book',
  'based on comic',
  'based on manga',
  'remake',
  'sequel',
  'prequel',
  'independent film',
  'female protagonist',
  'male protagonist',
  'live action remake',
  'short film',
  'lgbt',
  'anime',
  'reboot',
]);

/** gêneros do TMDB que mudam o tom (comédia, animação, família): penaliza se X não tiver */
export const TONE_GENRE_IDS = [35, 16, 10751];

/** Gêneros do TMDB de filme ↔ série (os de série são mais largos: "Sci-Fi & Fantasy", "Action & Adventure"). */
const MOVIE_TO_TV: Record<number, number[]> = { 878: [10765], 14: [10765], 28: [10759], 12: [10759], 10752: [10768], 53: [9648], 27: [9648] };
const TV_TO_MOVIE: Record<number, number[]> = { 10765: [878, 14], 10759: [28, 12], 10768: [10752] };
const SHARED_GENRES = new Set([18, 80, 9648, 35, 99, 10751, 16, 37]);

/** Os gêneros de X traduzidos para o outro tipo (filme → série ou o contrário). */
export function crossGenres(ids: number[], to: 'movie' | 'tv'): number[] {
  const map = to === 'tv' ? MOVIE_TO_TV : TV_TO_MOVIE;
  return [...new Set(ids.flatMap((g) => map[g] ?? (SHARED_GENRES.has(g) ? [g] : [])))];
}

/** até quantas obras a palavra-chave é "específica" (peso total, pode ir em pares no /discover) */
export const SPECIFIC_DF = 300;
/** acima disso é "ampla": peso × 0,3 e nunca sozinha no /discover */
export const BROAD_DF = 3000;

export interface RefKeyword {
  id: number;
  name: string;
  /** peso (IDF × ajuste); 0 = não conta */
  w: number;
  cls: 'specific' | 'medium' | 'broad';
}

/** Peso de cada palavra-chave de X: idf = ln((N+1)/(df+1)); ampla × 0,3; de cadastro, 0. */
export function weighKeywords(keywords: { id: number; name: string }[], df: Map<number, number>, total: number): RefKeyword[] {
  return keywords.map((k) => {
    const n = df.get(k.id) ?? BROAD_DF;
    const cls: RefKeyword['cls'] = n <= SPECIFIC_DF ? 'specific' : n <= BROAD_DF ? 'medium' : 'broad';
    const idf = Math.log((total + 1) / (n + 1));
    const w = META_KEYWORDS.has(k.name) ? 0 : Math.max(0, idf) * (cls === 'broad' ? 0.3 : 1);
    return { id: k.id, name: k.name, w, cls };
  });
}

/** As palavras-chave que valem para buscar no /discover, da mais específica para a menos (sem as amplas). */
export function searchKeywords(ref: RefKeyword[], max = 6): RefKeyword[] {
  return ref
    .filter((k) => k.w > 0 && k.cls !== 'broad')
    .sort((a, b) => b.w - a.w)
    .slice(0, max);
}

/**
 * Quanto do "DNA" de X o candidato tem (0..1): soma dos pesos das palavras-chave em comum sobre a soma
 * dos pesos de X. Só conta com prova suficiente: 1 específica ou 2 médias em comum; senão 0.
 */
export function keywordOverlap(ref: RefKeyword[], candidate: number[]): number {
  const has = new Set(candidate);
  const shared = ref.filter((k) => k.w > 0 && has.has(k.id));
  const enough = shared.some((k) => k.cls === 'specific') || shared.filter((k) => k.cls === 'medium').length >= 2;
  if (!enough) return 0;
  const total = ref.reduce((a, k) => a + k.w, 0);
  return total > 0 ? shared.reduce((a, k) => a + k.w, 0) / total : 0;
}

/** Nota geral com poucos votos puxada para a média, em 0..1 (5 → 0; 9 → 1). */
export function bayesQuality(avg?: number, votes?: number): number {
  const v = votes ?? 0;
  const m = 200;
  const r = avg ?? 6.5;
  const q = ((v / (v + m)) * r + (m / (v + m)) * 6.5 - 5) / 4;
  return Math.max(0, Math.min(1, q));
}

export interface RefTarget {
  mediaType: 'movie' | 'tv';
  genreIds: number[];
  keywords: RefKeyword[];
}

export interface RefSignals {
  mediaType: 'movie' | 'tv';
  genreIds: number[];
  keywordIds?: number[];
  voteAverage?: number;
  voteCount?: number;
  /** posição nas recomendações do TMDB (0 = primeira) */
  recPos?: number;
  /** posição nos semelhantes do TMDB */
  simPos?: number;
  /** posição na lista da IA */
  aiPos?: number;
  /** veio da busca por quem fez X */
  crew?: boolean;
}

/**
 * Nota de semelhança com X (0..1, pode ficar negativa com penalidades):
 * 0,40·palavras-chave + 0,20·recomendação + 0,20·IA + 0,08·gêneros + 0,05·equipe + 0,07·qualidade
 * + 0,05 se veio de 2 fontes ou mais − penalidades (tom diferente, outro tipo, poucos votos).
 */
export function referenceScore(c: RefSignals, ref: RefTarget): number {
  const kw = c.keywordIds ? keywordOverlap(ref.keywords, c.keywordIds) : 0;
  const rec = c.recPos != null ? 1 / (1 + c.recPos / 10) : c.simPos != null ? 0.4 / (1 + c.simPos / 10) : 0;
  const ai = c.aiPos != null ? 1 / (1 + c.aiPos / 15) : 0;
  const union = new Set([...ref.genreIds, ...c.genreIds]);
  const gen = union.size ? ref.genreIds.filter((g) => c.genreIds.includes(g)).length / union.size : 0;
  const crew = c.crew ? 1 : 0;
  const q = bayesQuality(c.voteAverage, c.voteCount);
  const sources = [kw > 0, c.recPos != null || c.simPos != null, c.aiPos != null, c.crew].filter(Boolean).length;
  let penalty = 0;
  if (TONE_GENRE_IDS.some((g) => c.genreIds.includes(g) && !ref.genreIds.includes(g))) penalty += 0.3;
  if (c.mediaType !== ref.mediaType) penalty += 0.15;
  if ((c.voteCount ?? 0) < 50) penalty += 0.2;
  return 0.4 * kw + 0.2 * rec + 0.2 * ai + 0.08 * gen + 0.05 * crew + 0.07 * q + (sources >= 2 ? 0.05 : 0) - penalty;
}

/**
 * Tem evidência de semelhança? Sem nenhuma (nem palavra-chave suficiente, nem recomendação, nem IA), o
 * candidato é genérico e sai; a mesma equipe só vale com 2 gêneros em comum. Semelhante do TMDB (ruidoso) só entra com gênero em comum e
 * alguma palavra-chave que conte.
 */
export function hasEvidence(c: RefSignals, ref: RefTarget): boolean {
  const kw = c.keywordIds ? keywordOverlap(ref.keywords, c.keywordIds) : 0;
  if (c.aiPos != null || c.recPos != null || kw > 0) return true;
  // mesma equipe sozinha não basta (Scorsese fez Ilha do Medo e Touro Indomável): só com 2 gêneros de X
  if (c.crew && ref.genreIds.filter((g) => c.genreIds.includes(g)).length >= 2) return true;
  if (c.simPos != null) {
    const shares = c.keywordIds?.some((id) => ref.keywords.some((k) => k.id === id && k.w > 0 && k.cls !== 'broad'));
    return Boolean(shares) && c.genreIds.some((g) => ref.genreIds.includes(g));
  }
  return false;
}
