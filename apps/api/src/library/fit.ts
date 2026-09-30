import {
  GENRES,
  GENRE_KEYS,
  type GenreKey,
  SUBGENRES,
  type SubgenreKey,
  type TasteStatementInterpretation,
  subgenresFromGenres,
} from '@fruiqo/taxonomy';

// RF-42/43/44: encaixe de um título na fila do usuário. Local e determinístico; nada daqui vai para
// o LLM (ARB-REQ-02). O score junta quatro fontes, cada uma em [-1, 1]:
//   declarado (favoritos + resumo livre), sinais (assistiu/abandonou/aceitou…), notas (avaliações
//   de títulos parecidos) e, só no rascunho de prioridade, a posição atual (a ordem do usuário pesa).
// As frases de "por quê" saem dos mesmos fatores.

const GENRE_SET = new Set<string>(GENRE_KEYS);
const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));
const SUBGENRE_LABEL = new Map<string, string>(SUBGENRES.map((s) => [s.key, s.label]));

export const FIT_WEIGHTS = { declared: 0.4, signals: 0.3, notes: 0.2, subgenre: 0.1, position: 0.25 } as const;

export interface FavoriteInput {
  title: string;
  genres: string[];
  rating?: number | null;
  tmdbId?: number | null;
  mediaType?: 'movie' | 'tv' | null;
}

export interface DeclaredAffinityEntry {
  score: number;
  source: 'favorites' | 'summary' | 'both';
}

/**
 * Afinidade declarada por gênero: cada favorito soma o peso da nota (sem nota = 0,6; 5★ = 1; 1★ = 0,2)
 * aos gêneros dele (suavizado por tanh); o resumo livre soma +0,8 ("gosto") ou -0,9 ("não gosto").
 */
export function declaredAffinity(
  favorites: FavoriteInput[],
  statement: TasteStatementInterpretation | null,
): Map<GenreKey, DeclaredAffinityEntry> {
  const favSums = new Map<GenreKey, number>();
  for (const f of favorites) {
    const w = f.rating ? f.rating / 5 : 0.6;
    for (const g of validGenres(f.genres)) favSums.set(g, (favSums.get(g) ?? 0) + w);
  }
  const summary = new Map<GenreKey, number>();
  for (const g of statement?.likes ?? []) summary.set(g, 0.8);
  for (const g of statement?.dislikes ?? []) summary.set(g, -0.9);

  const out = new Map<GenreKey, DeclaredAffinityEntry>();
  for (const g of new Set([...favSums.keys(), ...summary.keys()])) {
    const fav = favSums.has(g) ? Math.tanh(favSums.get(g)! / 1.5) : 0;
    const sum = summary.get(g) ?? 0;
    // "não gosto" dito no resumo vence os favoritos (o usuário foi explícito)
    const score = sum < 0 ? sum : clamp(fav + sum);
    out.set(g, {
      score: round(score),
      source: favSums.has(g) && summary.has(g) ? 'both' : favSums.has(g) ? 'favorites' : 'summary',
    });
  }
  return out;
}

export interface FitContext {
  declared: Map<GenreKey, DeclaredAffinityEntry>;
  likedSubgenres: Set<SubgenreKey>;
  dislikedSubgenres: Set<SubgenreKey>;
  /** afinidade por sinais, já com os overrides do perfil (fixado = 1, excluído = -1) */
  signals: Partial<Record<GenreKey, number>>;
  /** média das notas (1..5) de títulos do catálogo, por gênero */
  notes: Map<GenreKey, { avg: number; count: number }>;
  favorites: FavoriteInput[];
}

export interface FitTitle {
  title: string;
  genres: string[];
  tmdbId?: number | null;
  mediaType?: string | null;
}

export interface FitResult {
  score: number;
  reasons: string[];
  /** false = nada para comparar (sem gêneros): o encaixe sugerido é o fim da fila */
  basis: boolean;
}

/** Média das notas por gênero (só títulos avaliados). */
export function notesByGenre(rows: { genres: string[]; rating: number | null }[]): Map<GenreKey, { avg: number; count: number }> {
  const acc = new Map<GenreKey, { sum: number; count: number }>();
  for (const r of rows) {
    if (r.rating == null) continue;
    for (const g of validGenres(r.genres)) {
      const cur = acc.get(g) ?? { sum: 0, count: 0 };
      acc.set(g, { sum: cur.sum + r.rating, count: cur.count + 1 });
    }
  }
  return new Map([...acc].map(([g, v]) => [g, { avg: v.sum / v.count, count: v.count }]));
}

/** Score de encaixe (-1..1) com as razões em pt-BR, das mais fortes para as mais fracas. */
export function fitScore(t: FitTitle, ctx: FitContext): FitResult {
  const genres = validGenres(t.genres);
  const reasons: { text: string; weight: number }[] = [];
  const favorite = ctx.favorites.find((f) => f.tmdbId != null && t.tmdbId != null && f.tmdbId === t.tmdbId && (!f.mediaType || !t.mediaType || f.mediaType === t.mediaType));
  if (favorite) {
    return { score: 1, reasons: [`Está entre os seus favoritos (${favorite.title})`], basis: true };
  }
  if (genres.length === 0) {
    return { score: 0, reasons: ['Ainda sem gêneros: sem base para comparar com o seu gosto'], basis: false };
  }

  const avgOver = (f: (g: GenreKey) => number | undefined) => {
    const vals = genres.map(f).filter((v): v is number => v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / genres.length : 0;
  };

  const declared = avgOver((g) => ctx.declared.get(g)?.score);
  const likedDecl = genres.filter((g) => (ctx.declared.get(g)?.score ?? 0) >= 0.3);
  const dislikedDecl = genres.filter((g) => (ctx.declared.get(g)?.score ?? 0) <= -0.3);
  if (likedDecl.length) reasons.push({ text: `Você declarou gostar de ${labels(likedDecl)}`, weight: declared });
  if (dislikedDecl.length) reasons.push({ text: `Você disse que não curte ${labels(dislikedDecl)}`, weight: -declared + 1 });

  const signals = avgOver((g) => ctx.signals[g]);
  const likedSig = genres.filter((g) => (ctx.signals[g] ?? 0) >= 0.3 && !likedDecl.includes(g));
  const dislikedSig = genres.filter((g) => (ctx.signals[g] ?? 0) <= -0.3 && !dislikedDecl.includes(g));
  if (likedSig.length) reasons.push({ text: `Combina com o que você tem assistido (${labels(likedSig)})`, weight: signals });
  if (dislikedSig.length) reasons.push({ text: `Você costuma deixar de lado ${labels(dislikedSig)}`, weight: -signals + 0.5 });

  const noteVals = genres.map((g) => ctx.notes.get(g)).filter((n): n is { avg: number; count: number } => Boolean(n));
  const notes = noteVals.length ? noteVals.reduce((a, n) => a + (n.avg - 3) / 2, 0) / genres.length : 0;
  const goodNotes = genres.filter((g) => (ctx.notes.get(g)?.avg ?? 0) >= 4);
  const badNotes = genres.filter((g) => {
    const n = ctx.notes.get(g);
    return n !== undefined && n.avg <= 2;
  });
  if (goodNotes.length) reasons.push({ text: `Suas notas para ${labels(goodNotes)} são altas`, weight: notes });
  if (badNotes.length) reasons.push({ text: `Suas notas para ${labels(badNotes)} são baixas`, weight: -notes });

  const subs = subgenresFromGenres(genres);
  const likedSub = subs.filter((s) => ctx.likedSubgenres.has(s));
  const dislikedSub = subs.filter((s) => ctx.dislikedSubgenres.has(s));
  const subgenre = clamp(likedSub.length * 0.5 - dislikedSub.length * 0.7);
  if (likedSub.length) reasons.push({ text: `É ${subLabels(likedSub)}, como você descreveu no seu gosto`, weight: subgenre });
  if (dislikedSub.length) reasons.push({ text: `É ${subLabels(dislikedSub)}, que você disse evitar`, weight: -subgenre });

  // parecido com um favorito: gêneros em comum (Jaccard ≥ 0,5)
  const similar = ctx.favorites
    .map((f) => ({ f, j: jaccard(genres, validGenres(f.genres)) }))
    .filter((x) => x.j >= 0.5)
    .sort((a, b) => b.j - a.j || (b.f.rating ?? 0) - (a.f.rating ?? 0))[0];
  const similarBoost = similar ? 0.15 * similar.j : 0;
  if (similar) reasons.push({ text: `Parecido com ${similar.f.title}, um dos seus favoritos`, weight: 0.5 + similar.j });

  const score = clamp(
    FIT_WEIGHTS.declared * declared + FIT_WEIGHTS.signals * signals + FIT_WEIGHTS.notes * notes + FIT_WEIGHTS.subgenre * subgenre + similarBoost,
  );
  const ordered = reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text);
  if (ordered.length === 0) ordered.push(`Sem sinais do seu gosto para ${labels(genres)} ainda`);
  return { score: round(score), reasons: ordered.slice(0, 3), basis: true };
}

export interface QueueEntry {
  id: string;
  title: string;
  rank: number;
  status: 'catalog' | 'to_watch' | 'watching' | 'watched' | 'dropped';
  score: number;
}

export interface SuggestedPosition {
  position: number;
  total: number;
  before?: { id: string; title: string; rank: number };
}

/**
 * RF-42: posição sugerida = antes do primeiro título ainda aberto (para ver/assistindo) da fila, na
 * ordem atual, que encaixa claramente pior (margem de 0,05). Nenhum? Fim da fila. Não reordena
 * nada do que já está lá: só escolhe onde o novo entra.
 */
export function suggestPosition(fit: Pick<FitResult, 'score' | 'basis'>, queue: QueueEntry[]): SuggestedPosition {
  const sorted = [...queue].sort((a, b) => a.rank - b.rank);
  const total = sorted.length + 1;
  if (!fit.basis) return { position: total, total };
  const score = fit.score;
  const target = sorted.find((q) => (q.status === 'to_watch' || q.status === 'watching') && q.score + 0.05 < score);
  if (!target) return { position: total, total };
  return { position: target.rank, total, before: { id: target.id, title: target.title, rank: target.rank } };
}

export function positionReason(p: SuggestedPosition): string {
  if (!p.before) return p.total === 1 ? 'Primeiro título da sua fila' : `Entra no fim da fila (#${p.position})`;
  return `Entra em #${p.position}, antes de ${p.before.title}`;
}

export interface DraftCandidate {
  id: string;
  rank: number;
  status: QueueEntry['status'];
  fit: FitResult;
}

export interface DraftEntry {
  id: string;
  score: number;
  reason: string;
}

/**
 * RF-44: ordem proposta. "Para ver" é ordenado pelo score (encaixe + um peso pela posição atual,
 * para não embaralhar a fila à toa); o que já foi visto/abandonado vai para o fim, na ordem atual.
 * `to_watch` (padrão): "assistindo" fica no topo, na ordem atual. `all`: "assistindo" também entra
 * na ordenação, com um bônus por já ter começado.
 */
export function draftOrder(items: DraftCandidate[], scope: 'all' | 'to_watch' = 'to_watch'): DraftEntry[] {
  const n = items.length;
  const positionPrior = (rank: number) => (n <= 1 ? 0 : 1 - (2 * (rank - 1)) / (n - 1));
  const byRank = [...items].sort((a, b) => a.rank - b.rank);
  const scored = (i: DraftCandidate) => {
    const started = i.status === 'watching' ? 0.3 : 0;
    return round(clamp(i.fit.score + started + FIT_WEIGHTS.position * positionPrior(i.rank)));
  };
  const reasonOf = (i: DraftCandidate) =>
    i.status === 'watching' ? 'Você está assistindo' : (i.fit.reasons[0] ?? 'Mantém a sua ordem');
  const pinned = scope === 'to_watch' ? byRank.filter((i) => i.status === 'watching') : [];
  const sortable = byRank
    .filter((i) => i.status === 'to_watch' || (scope === 'all' && i.status === 'watching'))
    .map((i) => ({ i, score: scored(i) }))
    .sort((a, b) => b.score - a.score || a.i.rank - b.i.rank);
  const done = byRank.filter((i) => i.status === 'watched' || i.status === 'dropped');
  return [
    ...pinned.map((i) => ({ id: i.id, score: 1, reason: reasonOf(i) })),
    ...sortable.map(({ i, score }) => ({ id: i.id, score, reason: reasonOf(i) })),
    ...done.map((i) => ({ id: i.id, score: -1, reason: i.status === 'watched' ? 'Já assistido: vai para o fim' : 'Abandonado: vai para o fim' })),
  ];
}

function validGenres(genres: readonly string[]): GenreKey[] {
  return genres.filter((g): g is GenreKey => GENRE_SET.has(g));
}

function labels(keys: readonly string[]): string {
  const names = keys.map((k) => GENRE_LABEL.get(k) ?? k);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function subLabels(keys: readonly string[]): string {
  return keys
    .map((k) => (SUBGENRE_LABEL.get(k) ?? k).toLowerCase())
    .join(' e ');
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  return inter / new Set([...a, ...b]).size;
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
