import {
  GENRES,
  type GenreKey,
  type MoodIntent,
  NEED_WEIGHTS,
  type Need,
  SUBGENRES,
  type SubgenreKey,
  matchesRule,
  subgenresFromGenres,
} from '@fruiqo/taxonomy';

// Ranking local e determinístico (RF-36/RF-39, parte local). Nada aqui vai para o LLM (ARB-REQ-02):
// a intenção chega estruturada e os fatores do score viram a frase de "por que isso".

export interface RankItem {
  id: string;
  kind: 'movie' | 'series' | 'music_track' | 'music_album' | 'artist' | 'other';
  status: 'to_watch' | 'watching' | 'watched' | 'dropped';
  priority: number;
  genres: GenreKey[];
  attributes: string[];
  runtimeMin: number | null;
  createdAt: Date;
}

export type RankRequest =
  | { mode: 'surprise'; subgenre?: SubgenreKey; genre?: GenreKey }
  | { mode: 'mood'; intent: MoodIntent };

export type DiscoverKind = 'movie' | 'series' | 'music';

export interface RankContext {
  /** afinidade por gênero, em [-1, 1] (ver tasteFromSignals) */
  taste: Partial<Record<GenreKey, number>>;
  /** títulos pulados recentemente (não voltam para o topo logo em seguida) */
  recentlySkipped: ReadonlySet<string>;
  kinds?: DiscoverKind[];
}

export interface Ranked {
  id: string;
  score: number;
  reason: string;
}

const GENRE_LABEL = new Map(GENRES.map((g) => [g.key as string, g.label]));
const SUBGENRE_LABEL = new Map(SUBGENRES.map((s) => [s.key as string, s.label]));

export const NEED_LABEL: Record<Need, string> = {
  uplifting: 'levantar o astral',
  comfort: 'aconchego',
  catharsis: 'deixar a emoção sair',
  distraction: 'desligar a cabeça',
  laughter: 'rir',
  thrill: 'adrenalina',
  think: 'pensar',
  connection: 'ver junto',
  nostalgia: 'nostalgia',
};

/** Frase de cada fator que puxou o título para cima no "Como estou". */
const BOOST_PHRASE: Record<string, string> = {
  inspirational: 'História de superação',
  feelgood: 'Leve e para cima',
  comfort: 'Aconchegante, bom de rever',
  tearjerker: 'Para deixar a emoção sair',
  drama: 'Drama para sentir junto',
  slapstick: 'Besteirol sem compromisso',
  action: 'Ação para desligar a cabeça',
  heist: 'Golpe cheio de reviravolta',
  comedy: 'Comédia para rir',
  romcom: 'Comédia romântica',
  thriller: 'Suspense com adrenalina',
  psych_thriller: 'Thriller psicológico',
  horror: 'Terror para arrepiar',
  mind_bender: 'Dá o que pensar',
  documentary: 'Documentário que faz pensar',
  family: 'Clima de sessão da tarde',
  animation: 'Animação gostosa de ver',
};

/** Atributos derivados dos gêneros (taxonomia v1 §3); os explícitos do título somam a estes. */
export function derivedAttributes(item: Pick<RankItem, 'genres' | 'attributes' | 'runtimeMin'>): Set<string> {
  const g = new Set(item.genres);
  const out = new Set(item.attributes);
  if (g.has('romance')) out.add('romance_centric');
  const light = g.has('comedy') || g.has('family') || g.has('animation');
  if ((g.has('war') || g.has('horror') || g.has('drama')) && !light) out.add('heavy');
  if (g.has('horror') || g.has('war')) out.add('violence');
  if (item.runtimeMin != null && item.runtimeMin > 150) out.add('long');
  return out;
}

function kindMatches(kind: RankItem['kind'], kinds: DiscoverKind[] | undefined): boolean {
  if (!kinds || kinds.length === 0) return true;
  return kinds.some((k) => (k === 'music' ? kind === 'music_track' || kind === 'music_album' || kind === 'artist' : kind === k));
}

interface Scored extends Ranked {
  eligible: boolean;
  unknownGenre: boolean;
  priority: number;
  createdAt: Date;
}

function tasteScore(genres: GenreKey[], taste: RankContext['taste']): { value: number; top?: GenreKey } {
  if (genres.length === 0) return { value: 0 };
  let sum = 0;
  let top: GenreKey | undefined;
  for (const g of genres) {
    const v = taste[g] ?? 0;
    sum += v;
    if (v > 0 && (top === undefined || v > (taste[top] ?? 0))) top = g;
  }
  return { value: sum / genres.length, ...(top ? { top } : {}) };
}

function scoreItem(item: RankItem, req: RankRequest, ctx: RankContext): Scored {
  const genres = new Set(item.genres);
  const subgenres = new Set<string>(subgenresFromGenres(item.genres));
  const attrs = derivedAttributes(item);
  const has = (key: string) => genres.has(key as GenreKey) || subgenres.has(key) || attrs.has(key);
  const unknownGenre = item.genres.length === 0;

  let fit = 0;
  let eligible = !unknownGenre;
  const factors: { weight: number; text: string }[] = [];

  if (req.mode === 'surprise') {
    if (req.subgenre) {
      const def = SUBGENRES.find((s) => s.key === req.subgenre)!;
      if (matchesRule(def.rule, genres)) {
        fit = 1;
        factors.push({ weight: 1, text: `${def.label}, como você pediu` });
      } else if (!def.rule.none?.some((g) => genres.has(g))) {
        const wanted = def.rule.all ?? [];
        const present = wanted.filter((g) => genres.has(g));
        fit = wanted.length > 0 ? (present.length / wanted.length) * 0.4 : 0;
        if (present.length > 0) {
          factors.push({ weight: fit, text: `Tem ${present.map((g) => GENRE_LABEL.get(g)!.toLowerCase()).join(' e ')}, perto de ${def.label.toLowerCase()}` });
        }
      }
    } else if (req.genre && genres.has(req.genre)) {
      fit = 1;
      factors.push({ weight: 1, text: `${GENRE_LABEL.get(req.genre)}, como você pediu` });
    }
    eligible &&= fit > 0;
  } else {
    const { intent } = req;
    const weights = NEED_WEIGHTS[intent.need];
    for (const [key, w] of Object.entries(weights.boost)) {
      if (w && has(key)) {
        fit += w;
        factors.push({ weight: w, text: BOOST_PHRASE[key] ?? `Combina com ${NEED_LABEL[intent.need]}` });
      }
    }
    for (const [key, w] of Object.entries(weights.penalize)) {
      if (w && has(key)) fit -= w;
    }
    const avoidHit = intent.avoid.some((a) => has(a));
    if (avoidHit) fit -= 1;
    if (intent.maxRuntimeMin && item.runtimeMin && item.runtimeMin > intent.maxRuntimeMin) fit -= 0.5;
    // o que foi evitado a pedido também explica a escolha
    if (!avoidHit && intent.avoid.includes('romance_centric')) factors.push({ weight: 0.05, text: 'sem romance no centro' });
    if (!avoidHit && intent.avoid.includes('heavy')) factors.push({ weight: 0.04, text: 'nada pesado' });
    eligible &&= !avoidHit && fit > 0;
  }

  const taste = tasteScore(item.genres, ctx.taste);
  if (taste.top && taste.value > 0.2) factors.push({ weight: taste.value * 0.3, text: `você curte ${GENRE_LABEL.get(taste.top)!.toLowerCase()}` });
  if (item.status === 'watching') factors.push({ weight: 0.05, text: 'você já começou' });
  if (item.priority >= 2) factors.push({ weight: 0.04, text: 'está com prioridade alta na sua lista' });

  const skipped = ctx.recentlySkipped.has(item.id);
  const score = fit + taste.value * 0.3 + (item.priority - 1) * 0.08 + (item.status === 'watching' ? 0.05 : 0) - (skipped ? 0.4 : 0);

  let reason: string;
  if (unknownGenre) {
    reason = 'Está na sua lista, mas sem gênero cadastrado (não dá para saber se combina)';
  } else {
    const parts = factors.sort((a, b) => b.weight - a.weight).map((f) => f.text);
    const unique = [...new Set(parts)].slice(0, 3);
    reason = unique.length > 0 ? capitalize(unique.join(' · ')) : 'Está na sua lista para ver';
  }
  return { id: item.id, score: round(score), reason, eligible, unknownGenre, priority: item.priority, createdAt: item.createdAt };
}

/** Mínimo de sugestões antes de completar com títulos sem gênero cadastrado. */
export const MIN_SUGGESTIONS = 3;

/**
 * Candidatos = títulos para ver/em andamento do tipo pedido. Elegíveis (combinam com a intenção)
 * vêm primeiro; títulos sem gênero só completam a lista se houver menos de MIN_SUGGESTIONS.
 * Empates: prioridade, depois o mais antigo na lista, depois o id (determinístico).
 */
export function rankTitles(items: RankItem[], req: RankRequest, ctx: RankContext): Ranked[] {
  const kinds = ctx.kinds ?? (req.mode === 'mood' && req.intent.kinds.length > 0 ? (req.intent.kinds as DiscoverKind[]) : undefined);
  const scored = items
    .filter((i) => (i.status === 'to_watch' || i.status === 'watching') && kindMatches(i.kind, kinds))
    .map((i) => scoreItem(i, req, ctx));
  const order = (a: Scored, b: Scored) =>
    b.score - a.score || b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  const eligible = scored.filter((s) => s.eligible).sort(order);
  const fallback =
    eligible.length < MIN_SUGGESTIONS
      ? scored
          .filter((s) => s.unknownGenre)
          .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      : [];
  return [...eligible, ...fallback].map(({ id, score, reason }) => ({ id, score, reason }));
}

// ---------- perfil de gosto (RF-34) ----------

export interface SignalRow {
  signal: 'watched' | 'rated' | 'dropped' | 'added_to_list' | 'accepted' | 'skipped';
  value: number;
  genres: GenreKey[];
}

const SIGNAL_WEIGHT: Record<SignalRow['signal'], (value: number) => number> = {
  watched: () => 1,
  rated: (v) => ((v - 3) / 2) * 1.5,
  dropped: () => -1,
  added_to_list: () => 0.3,
  accepted: () => 0.5,
  skipped: () => -0.3,
};

/** Afinidade por gênero em [-1, 1]: soma ponderada dos sinais, suavizada por tanh. */
export function tasteFromSignals(signals: SignalRow[]): Partial<Record<GenreKey, number>> {
  const sum: Partial<Record<GenreKey, number>> = {};
  for (const s of signals) {
    const w = SIGNAL_WEIGHT[s.signal](s.value);
    for (const g of s.genres) sum[g] = (sum[g] ?? 0) + w;
  }
  const out: Partial<Record<GenreKey, number>> = {};
  for (const [g, v] of Object.entries(sum) as [GenreKey, number][]) out[g] = round(Math.tanh(v / 3));
  return out;
}

// ---------- "Continuar" (RF-31) ----------

export interface ContinueList {
  id: string;
  pinned: boolean;
  lastActivity: Date;
  items: { id: string; status: RankItem['status']; position: number }[];
}

/**
 * Lista "em andamento" = tem pelo menos um item resolvido (assistido/abandonado) ou em andamento
 * e ainda sobra algo. Fixadas primeiro, depois a de atividade mais recente. Próximo item: o que está
 * em andamento; senão o primeiro "para ver" na ordem da lista (a ordem é a priorização do usuário).
 */
export function pickContinue(listsIn: ContinueList[]): { listId: string; nextId: string; done: number; total: number } | null {
  const candidates = listsIn
    .map((l) => {
      const sorted = [...l.items].sort((a, b) => a.position - b.position);
      const done = sorted.filter((i) => i.status === 'watched' || i.status === 'dropped').length;
      const started = done > 0 || sorted.some((i) => i.status === 'watching');
      const next = sorted.find((i) => i.status === 'watching') ?? sorted.find((i) => i.status === 'to_watch');
      return { l, done, total: sorted.length, started, next };
    })
    .filter((c) => c.started && c.next)
    .sort(
      (a, b) =>
        Number(b.l.pinned) - Number(a.l.pinned) || b.l.lastActivity.getTime() - a.l.lastActivity.getTime() || a.l.id.localeCompare(b.l.id),
    );
  const best = candidates[0];
  return best ? { listId: best.l.id, nextId: best.next!.id, done: best.done, total: best.total } : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export { GENRE_LABEL, SUBGENRE_LABEL };
