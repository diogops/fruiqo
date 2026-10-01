import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { SummaryDraft, Title, TitleSearchResult, TonightDefaults, TonightHideRequest, TonightRequest, TonightResponse, TonightShelfKey, TonightShelfPageResponse, TonightShelvesResponse, TonightWatchedRequest } from '@fruiqo/contracts';
import { detectRisk, GENRES, type GenreKey, RISK_SUPPORT, SUBGENRES } from '@fruiqo/taxonomy';
import { and, arrayOverlaps, asc, count, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import { overrideScore, recommendations, tasteFavorites, tasteOverrides, tasteStatements, tasteSubgenrePrefs, tonightHidden, userSubscriptions } from '../db/schema.js';
import type { TmdbHit, TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import {
  type Candidate,
  discoverParams,
  type DiscoverQuery,
  hitGenres,
  planMaxRuntime,
  isAnime,
  planAccepts,
  compareCandidates,
  franchiseKey,
  rate,
  reasonFor,
  type Source,
  withSelectedGenre,
} from './tonight-video.js';
import { type Attr, ATTRIBUTES, EMPTY_PLAN, localPlan, originCountries, planIsEmpty, planLabel, requiredAttrs, type TonightPlan } from './tonight-plan.js';
import { withAiUsage } from '../ai-usage/usage.js';
import { CatalogService } from './catalog.service.js';
import { LibraryService } from './library.service.js';
import { PROVIDER_LABEL, STREAMING_PROVIDERS } from './providers.js';
import { tmdbGenreIds } from './search-query.js';
import { PerUserRateLimiter, SearchService } from './search.service.js';
import { briefIsEmpty, TASTE_AI, type TasteAi, type TasteBrief, type TonightKind } from './taste-ai.js';
import { TMDB_CATALOG } from './tmdb-catalog.js';
import { userAllowsAi } from './user-settings.js';

const GENRE_LABEL = new Map<string, string>(GENRES.map((g) => [g.key, g.label]));
const SUBGENRE_LABEL = new Map<string, string>(SUBGENRES.map((s) => [s.key, s.label]));
// listas limitadas: entrada menor na IA (D-25, custo de tokens)
const MAX_FAVORITES = 10;
const MAX_LOVED = 10;
const LOVED_MIN_RATING = 4;
const DISLIKED_MAX_RATING = 2;
const MAX_DISLIKED = 8;
const MAX_QUEUE = 10;
const TONIGHT_SIZE = 5;
const GROUP_ORDER = { love: 0, like: 1, neutral: 2, avoid: 3 } as const;
/** "você vê mais X": peso mínimo e fatia para pré-selecionar o tipo */
const KIND_MIN_WEIGHT = 6;
const KIND_SHARE = 0.65;
/** gerador da IA (só complemento, quando a busca não chega a 5): quantos nomes pedir */
const AI_CANDIDATES = 20;
/** no modo gerador: amostra do que já viu, dos gêneros da busca, como "não sugerir" */
const SEEN_SAMPLE = 40;
/** estoque da sessão: repõe quando cai abaixo disto */
const STOCK_LOW = 10;
/** reposição: no máximo esta quantidade de páginas novas do TMDB por pedido */
const PAGE_BUDGET = 8;
/** cache de disponibilidade (TMDB/JustWatch) e de IDs de palavra-chave */
const AVAILABILITY_TTL_MS = 6 * 3_600_000;
/** serviços declarados (RF-38) → IDs de provedor do TMDB, para o /discover da busca local */
const PROVIDER_TMDB_IDS: Record<string, number[]> = {
  netflix: [8],
  prime_video: [119],
  disney_plus: [337],
  max: [1899, 384],
  globoplay: [307],
  apple_tv_plus: [350],
  paramount_plus: [531],
  mubi: [11],
  crunchyroll: [283],
};
/** prateleiras: por quanto tempo valem (as listas do TMDB mudam devagar) e até quantas páginas rolam */
const SHELF_TTL_MS = 3_600_000;
const SHELF_MAX_PAGES = 25;
type ShelfMedia = 'movie' | 'tv';
interface ShelfDef {
  key: TonightShelfKey;
  label: string;
  params: (m: ShelfMedia) => Parameters<TmdbResolver['discoverBrowse']>[1];
}
/** fora das prateleiras: animação (só quando pedida, como na busca) e, em séries, jornal, reality, novela e talk show */
const SHELF_NOISE = { movie: [16], tv: [16, 10763, 10764, 10766, 10767] } as const;
/** ação e ficção científica: só o que é recente e bem avaliado (sem procedural antigo de 20 temporadas) */
const SHELF_RECENT_YEARS = 8;
const SHELF_MIN_RATING = 6.8;
const SHELF_MIN_VOTES = 300;
/**
 * Série de "ficção científica" no TMDB é "Sci-Fi & Fantasy" (vampiro e bruxa entram): na prateleira, a
 * série precisa de uma palavra-chave de ficção de verdade.
 */
const SCIFI_TV_KEYWORDS = ['science fiction', 'space', 'outer space', 'dystopia', 'alien', 'time travel', 'artificial intelligence (a.i.)', 'cyberpunk', 'post-apocalyptic future'];
/** o que foi sugerido fica lembrado por um tempo, para "novas sugestões" não repetirem */
const SHOWN_TTL_MS = 6 * 3_600_000;

/** "a, b e c" */
function joinPt(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Resumo sugerido a partir das escolhas (níveis, subgêneros, favoritos, notas altas). Local, sem IA:
 * é um ponto de partida que o usuário edita, melhora com IA ou descarta.
 */
export function suggestedSummary(b: TasteBrief): string {
  const parts: string[] = [];
  if (b.loves.length) parts.push(`Adoro ${joinPt(b.loves.map(lower))}.`);
  if (b.likes.length) parts.push(`Gosto de ${joinPt(b.likes.map(lower))}.`);
  if (b.likedSubgenres.length) parts.push(`Curto especialmente ${joinPt(b.likedSubgenres.map(lower))}.`);
  if (b.dislikes.length) parts.push(`Não curto muito ${joinPt(b.dislikes.map(lower))}.`);
  if (b.hates.length) parts.push(`Não gosto de ${joinPt(b.hates.map(lower))}.`);
  if (b.dislikedSubgenres.length) parts.push(`Evito ${joinPt(b.dislikedSubgenres.map(lower))}.`);
  const work = (t: { title: string; year?: number }) => `${t.title}${t.year ? ` (${t.year})` : ''}`;
  if (b.favorites.length) {
    const favs = b.favorites.slice(0, 10).map((f) => `${work(f)}${f.comment ? `, que me marcou por "${f.comment}"` : ''}`);
    parts.push(`Entre meus favoritos estão ${joinPt(favs)}.`);
  }
  const extra = b.loved.filter((l) => !b.favorites.some((f) => f.title === l.title)).slice(0, 8);
  if (extra.length) parts.push(`Também gostei muito de ${joinPt(extra.map(work))}.`);
  return parts.join(' ');
}

type TonightItem = TonightResponse['items'][number];
const normTitle = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const levelBucket = (v: number): 'loves' | 'likes' | 'dislikes' | 'hates' | null =>
  v >= 0.75 ? 'loves' : v >= 0.25 ? 'likes' : v <= -0.75 ? 'hates' : v <= -0.25 ? 'dislikes' : null;

@Injectable()
export class TonightService {
  private readonly limiter = new PerUserRateLimiter(Number(process.env.TONIGHT_RATE_LIMIT_PER_MIN ?? 10), 60_000);
  /** userId → (chave "movie:123" → nome mostrado, quando) */
  private readonly shown = new Map<string, Map<string, { name: string; at: number }>>();
  /**
   * Sessão do painel (filme/série): o que já mostrou, o plano entendido, o estoque ordenado e as
   * páginas já lidas de cada fonte. Mudar filtro/pedido cria uma revisão (estoque e páginas zeram;
   * o que já foi mostrado continua fora). Em memória: uma instância, um usuário (SC-PERSONAL).
   */
  private readonly sessions = new Map<string, VideoSession>();
  private readonly keywordIds = new Map<string, number | null>();
  private readonly titleKeywords = new Map<string, { ids: number[]; at: number }>();
  private readonly titleCountries = new Map<string, { ids: string[]; at: number }>();
  private readonly shelfCache = new Map<string, { value: TonightShelvesResponse; at: number }>();
  private readonly availability = new Map<string, { providers: { key?: string; name: string; type: string }[]; at: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly search: SearchService,
    private readonly library: LibraryService,
    private readonly catalog: CatalogService,
    @Optional() @Inject(TASTE_AI) private readonly ai: TasteAi | null = null,
    @Optional() @Inject(TMDB_CATALOG) private readonly tmdb: TmdbResolver | null = null,
  ) {}

  /**
   * D-25: só o que o usuário declarou — resumo, níveis que ELE marcou, subgêneros marcados, nomes
   * dos favoritos e dos títulos com nota alta. Nada de gênero aprendido, sinopse ou nota do TMDB.
   */
  async brief(userId: string, avoid: string[] = []): Promise<TasteBrief> {
    return withUser(this.db, userId, async (tx) => {
      const [statement] = await tx.select().from(tasteStatements);
      const b: TasteBrief = {
        summary: statement?.summary ?? null,
        loves: [],
        likes: [],
        dislikes: [],
        hates: [],
        likedSubgenres: [],
        dislikedSubgenres: [],
        favorites: [],
        loved: [],
        disliked: [],
        queue: [],
        avoid,
      };
      const overrides = (await tx.select().from(tasteOverrides)).sort((a, z) => overrideScore(z) - overrideScore(a));
      for (const o of overrides) {
        const bucket = levelBucket(overrideScore(o));
        const label = GENRE_LABEL.get(o.genre);
        if (bucket && label) b[bucket].push(label);
      }
      for (const p of await tx.select().from(tasteSubgenrePrefs)) {
        const label = SUBGENRE_LABEL.get(p.subgenre);
        if (label) (p.pref === 'like' ? b.likedSubgenres : b.dislikedSubgenres).push(label);
      }
      const favorites = await tx.select().from(tasteFavorites).orderBy(desc(tasteFavorites.rating), desc(tasteFavorites.createdAt));
      b.favorites = favorites.slice(0, MAX_FAVORITES).map((f) => ({
        title: f.title,
        ...(f.year ? { year: f.year } : {}),
        ...(f.rating ? { rating: f.rating } : {}),
        ...(f.comment?.trim() ? { comment: f.comment.trim().slice(0, 120) } : {}),
      }));
      const loved = await tx
        .select({ title: recommendations.title, year: recommendations.year, rating: recommendations.rating, kind: recommendations.kind })
        .from(recommendations)
        .where(gte(recommendations.rating, LOVED_MIN_RATING))
        .orderBy(desc(recommendations.rating), desc(recommendations.updatedAt));
      const work = (l: { title: string; year: number | null; rating: number | null; creator?: string | null }) => ({
        title: l.creator ? `${l.title} – ${l.creator}` : l.title,
        ...(l.year ? { year: l.year } : {}),
        rating: l.rating!,
      });
      b.loved = loved.filter((l) => l.kind !== 'other').slice(0, MAX_LOVED).map(work);
      // histórico: o que não agradou também orienta (e não volta)
      const disliked = await tx
        .select({ title: recommendations.title, year: recommendations.year, rating: recommendations.rating, kind: recommendations.kind })
        .from(recommendations)
        .where(lte(recommendations.rating, DISLIKED_MAX_RATING))
        .orderBy(asc(recommendations.rating), desc(recommendations.updatedAt));
      b.disliked = disliked.filter((l) => l.kind !== 'other').slice(0, MAX_DISLIKED).map(work);
      // as prioridades que ele definiu: a fila da Minha Área, na ordem dele
      const queue = await tx
        .select({ title: recommendations.title, year: recommendations.year })
        .from(recommendations)
        .where(isNotNull(recommendations.rank))
        .orderBy(asc(recommendations.rank))
        .limit(MAX_QUEUE);
      b.queue = queue.map((q) => ({ title: q.title, ...(q.year ? { year: q.year } : {}) }));
      return b;
    });
  }

  /**
   * O widget já abre com a sua cara: gêneros na ordem do seu gosto (aprendido + ajustes, o mesmo
   * perfil da tela de Perfil) e o tipo que você mais consome (filme ou série), quando há um claro.
   */
  async defaults(userId: string): Promise<TonightDefaults> {
    const taste = await this.catalog.taste(userId);
    const known = new Map(taste.genres.map((g) => [g.key, g]));
    const group = (score: number, excluded: boolean): TonightDefaults['genres'][number]['group'] =>
      excluded || score <= -0.25 ? 'avoid' : score >= 0.6 ? 'love' : score >= 0.15 ? 'like' : 'neutral';
    const genres = GENRES.map((g) => {
      const t = known.get(g.key);
      const score = t?.score ?? 0;
      return {
        key: g.key,
        label: g.label,
        score,
        group: group(score, t?.source === 'excluded'),
        forVideo: g.tmdbMovie.length + g.tmdbTv.length > 0,
      };
    }).sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.score - a.score || a.label.localeCompare(b.label, 'pt-BR'));

    // hábito: o que você assiste, está assistindo, quer ver ou avaliou bem
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select({ kind: recommendations.kind, status: recommendations.status, rating: recommendations.rating })
        .from(recommendations)
        .where(inArray(recommendations.status, ['watched', 'watching', 'to_watch'])),
    );
    let movie = 0;
    let series = 0;
    for (const r of rows) {
      const w = (r.status === 'watched' ? 2 : 1) + ((r.rating ?? 0) >= LOVED_MIN_RATING ? 1 : 0);
      if (r.kind === 'movie') movie += w;
      else if (r.kind === 'series') series += w;
    }
    const total = movie + series;
    const kind = total >= KIND_MIN_WEIGHT ? (movie / total >= KIND_SHARE ? 'movie' : series / total >= KIND_SHARE ? 'series' : null) : null;
    const { summary, prefs, subs } = await withUser(this.db, userId, async (tx) => ({
      summary: (await tx.select().from(tasteStatements))[0]?.summary ?? null,
      prefs: new Map((await tx.select().from(tasteSubgenrePrefs)).map((p) => [p.subgenre, p.pref])),
      subs: new Set((await tx.select().from(userSubscriptions)).map((r) => r.provider)),
    }));
    const prefOrder = (p: 'like' | 'dislike' | null) => (p === 'like' ? 0 : p === 'dislike' ? 2 : 1);
    return {
      kind,
      genres: genres.map(({ score: _score, ...g }) => g),
      top: genres.filter((g) => g.group === 'love' || g.group === 'like').slice(0, 3).map((g) => g.label),
      summary,
      subgenres: SUBGENRES.map((s) => ({ key: s.key, label: s.label, pref: prefs.get(s.key) ?? null })).sort(
        (a, b) => prefOrder(a.pref) - prefOrder(b.pref) || a.label.localeCompare(b.label, 'pt-BR'),
      ),
      services: STREAMING_PROVIDERS.filter((p) => p.category === 'video' && PROVIDER_TMDB_IDS[p.key]).map((p) => ({
        key: p.key,
        label: p.label,
        selected: subs.has(p.key),
      })),
    };
  }

  async suggestSummary(userId: string): Promise<SummaryDraft> {
    return { summary: suggestedSummary(await this.brief(userId)), aiUsed: false };
  }

  async improveSummary(userId: string, text: string): Promise<SummaryDraft> {
    if (!this.ai) return { summary: text, aiUsed: false, unavailable: 'disabled' };
    if (!this.limiter.take(userId)) throw tooMany();
    if (!(await userAllowsAi(this.db, userId))) return { summary: text, aiUsed: false, unavailable: 'consent' };
    const ai = this.ai;
    const res = await withAiUsage(userId, 'summary_improve', () => ai.improveSummary(text, userId));
    return res.ok ? { summary: res.value, aiUsed: true } : { summary: text, aiUsed: false, unavailable: res.reason === 'too_long' ? 'too_long' : res.reason };
  }

  async tonight(userId: string, req: TonightRequest): Promise<TonightResponse> {
    if (!this.limiter.take(userId)) throw tooMany();
    const mood = req.mood?.trim() || undefined;
    // RNF-07: risco no humor vem antes de tudo (e o texto não vai a lugar nenhum)
    if (mood && detectRisk(mood).risk) return { aiUsed: false, risk: { ...RISK_SUPPORT }, services: [], items: [] };

    const kind: TonightKind | undefined = req.kind;
    const video = kind === undefined || kind === 'movie' || kind === 'series';
    const genreKey = req.genre && GENRE_LABEL.has(req.genre) ? (req.genre as GenreKey) : undefined;
    const genre = genreKey ? GENRE_LABEL.get(genreKey)! : req.genre;
    const exclude = new Set(req.exclude ?? []);
    const shown = this.shownFor(userId);
    const avoid = [...exclude].flatMap((k) => (shown.get(k) ? [shown.get(k)!.name] : []));
    const brief: TasteBrief = { ...(await this.brief(userId, avoid)), ...(mood ? { mood } : {}), ...(genre ? { genre } : {}) };
    // "Avançado": o perfil desta busca substitui as partes do Perfil que vieram (não salva nada)
    const p = req.profile;
    let override: { liked: GenreKey[]; hated: GenreKey[] } | undefined;
    if (p?.summary !== undefined) brief.summary = p.summary.trim() || null;
    if (p?.genres) {
      const valid = p.genres.filter((g) => GENRE_LABEL.has(g.key));
      const labels = (grp: string) => valid.filter((g) => g.group === grp).map((g) => GENRE_LABEL.get(g.key)!);
      brief.loves = labels('love');
      brief.likes = labels('like');
      brief.dislikes = [];
      brief.hates = labels('avoid');
      override = {
        liked: valid.filter((g) => g.group === 'love' || g.group === 'like').map((g) => g.key as GenreKey),
        hated: valid.filter((g) => g.group === 'avoid').map((g) => g.key as GenreKey),
      };
    }
    if (p?.subgenres) {
      const label = (k: string) => SUBGENRE_LABEL.get(k);
      brief.likedSubgenres = p.subgenres.flatMap((s) => (s.pref === 'like' && label(s.key) ? [label(s.key)!] : []));
      brief.dislikedSubgenres = p.subgenres.flatMap((s) => (s.pref === 'dislike' && label(s.key) ? [label(s.key)!] : []));
    }
    const { subs, favoriteKeys, favoriteTitles, hidden } = await withUser(this.db, userId, async (tx) => {
      const favorites = await tx.select({ tmdbId: tasteFavorites.tmdbId, mediaType: tasteFavorites.mediaType, olWorkId: tasteFavorites.olWorkId, title: tasteFavorites.title }).from(tasteFavorites);
      return {
        hidden: await this.hiddenKeys(tx),
        subs: (await tx.select().from(userSubscriptions)).map((r) => r.provider).filter((p) => PROVIDER_TMDB_IDS[p]),
        favoriteKeys: new Set([
          ...favorites.filter((f) => f.tmdbId && f.mediaType).map((f) => `${f.mediaType}:${f.tmdbId}`),
          ...favorites.filter((f) => f.olWorkId).map((f) => `book:${f.olWorkId}`),
        ]),
        favoriteTitles: new Set(favorites.map((f) => normTitle(f.title))),
      };
    });
    // streamings escolhidos na tela (vazio = em qualquer lugar; ausente = os do Perfil). Sem filtro,
    // ainda mostra onde está no Brasil
    const filterSubs = req.services !== undefined ? [...new Set(req.services)].filter((k) => PROVIDER_TMDB_IDS[k]) : subs;
    const services = video ? filterSubs.map((k) => PROVIDER_LABEL.get(k) ?? k) : [];
    if (services.length) brief.services = services;
    // anime só quando pedido (padrão: sem)
    if (video) brief.anime = Boolean(req.includeAnime);
    // nada do que você já assistiu/leu/ouviu, abandonou, marcou como favorito ou já viu nesta rodada
    // "Incluir já vistos": assistidos/abandonados podem voltar (o que já apareceu na sessão, não)
    const fresh = (key: string, titles: (string | undefined)[], status?: string) =>
      (req.includeSeen || (status !== 'watched' && status !== 'dropped')) &&
      !favoriteKeys.has(key) &&
      !hidden.has(key) &&
      !titles.some((t) => t && favoriteTitles.has(normTitle(t))) &&
      !exclude.has(key);
    const freshMedia = (it: { mediaType: string; tmdbId: number; title: string; originalTitle?: string; inLibrary: { status?: string } | null }) =>
      fresh(`${it.mediaType}:${it.tmdbId}`, [it.title, it.originalTitle], it.inLibrary?.status);

    let unavailable: TonightResponse['unavailable'];
    let aiUsed = false;
    let request: string | undefined;
    let picked: TonightItem[] = [];
    let books: NonNullable<TonightResponse['books']> | undefined;
    let music: NonNullable<TonightResponse['music']> | undefined;
    let understood: string | undefined;
    let unmapped: string[] | undefined;
    let exhausted = false;
    const aiAllowed = Boolean(this.ai) && (await userAllowsAi(this.db, userId));

    if (video) {
      const r = await this.videoTonight(userId, req, {
        mood,
        genreKey,
        filterSubs,
        exclude,
        freshMedia,
        aiAllowed,
        brief,
        hated: override?.hated,
        liked: override?.liked,
      });
      ({ picked, aiUsed, understood, unmapped, exhausted } = r);
      request = understood;
      if (!this.ai) unavailable = 'disabled';
      else if (!aiAllowed) unavailable = 'consent';
      else if (r.failed) unavailable = r.failed;
    } else if (!this.ai) unavailable = 'disabled';
    else if (!aiAllowed) unavailable = 'consent';
    else if (briefIsEmpty(brief)) unavailable = 'no_profile';
    else {
      const ai = this.ai;
      const res = await withAiUsage(userId, 'tonight_titles', () => ai.tonight(brief, userId, kind));
      if (!res.ok) unavailable = res.reason === 'too_long' ? 'failed' : res.reason;
      else {
        aiUsed = true;
        request = res.value.request;
        const picks = res.value.picks;
        if (kind === 'book') {
          const found = await this.search.confirmBookGuesses(userId, picks.filter((x) => x.kind === 'book')).catch(() => []);
          books = found.filter((bk) => fresh(`book:${bk.olWorkId}`, [bk.title], bk.inLibrary?.status)).slice(0, TONIGHT_SIZE);
        } else {
          music = picks
            .filter((x) => x.kind === 'music_track' || x.kind === 'music_album' || x.kind === 'artist')
            .map((x) => ({
              key: `music:${slug(`${x.title} ${x.creator ?? ''}`)}`,
              title: x.title,
              ...(x.creator ? { artist: x.creator } : {}),
              kind: x.kind as 'music_track' | 'music_album' | 'artist',
              ...(x.year ? { year: x.year } : {}),
              ...(x.reason ? { aiReason: x.reason } : {}),
            }))
            .filter((m) => fresh(m.key, [m.title]))
            .slice(0, TONIGHT_SIZE);
        }
      }
    }

    const now = Date.now();
    const remember = (key: string, name: string) => shown.set(key, { name, at: now });
    for (const it of picked) remember(`${it.mediaType}:${it.tmdbId}`, `${it.title}${it.year ? ` (${it.year})` : ''}`);
    for (const b of books ?? []) remember(`book:${b.olWorkId}`, `${b.title}${b.authors[0] ? ` – ${b.authors[0]}` : ''}`);
    for (const m of music ?? []) remember(m.key, `${m.title}${m.artist ? ` – ${m.artist}` : ''}`);
    return {
      aiUsed,
      ...(unavailable ? { unavailable } : {}),
      ...(request ? { request } : {}),
      ...(understood ? { understood } : {}),
      ...(unmapped?.length ? { unmapped } : {}),
      ...(exhausted ? { exhausted } : {}),
      services,
      items: picked,
      ...(books ? { books } : {}),
      ...(music ? { music } : {}),
    };
  }

  /**
   * Filme/série: plano → Minha Área primeiro → descobertas no TMDB → pontuação local → disponibilidade
   * dos finalistas. A IA só interpreta o pedido (quando o parser local não entendeu tudo) e, se ainda
   * faltar, sugere nomes uma vez por pedido (complemento).
   */
  private async videoTonight(
    userId: string,
    req: TonightRequest,
    ctx: {
      mood?: string;
      genreKey?: GenreKey;
      filterSubs: string[];
      exclude: Set<string>;
      freshMedia: (it: TitleSearchResult & { anime?: boolean }) => boolean;
      aiAllowed: boolean;
      brief: TasteBrief;
      liked?: GenreKey[];
      hated?: GenreKey[];
    },
  ): Promise<{ picked: TonightItem[]; aiUsed: boolean; understood?: string; unmapped?: string[]; exhausted: boolean; failed?: 'quota' | 'failed' }> {
    const sessionKey = `${userId}:${req.sessionId ?? 'default'}`;
    const sig = JSON.stringify({
      kind: req.kind ?? null,
      genre: req.genre ?? null,
      mood: ctx.mood ?? null,
      subs: [...ctx.filterSubs].sort(),
      profile: req.profile ?? null,
      anime: Boolean(req.includeAnime),
      seen: Boolean(req.includeSeen),
      queue: req.includeQueue !== false,
    });
    let session = this.sessions.get(sessionKey);
    let aiUsed = false;
    let failed: 'quota' | 'failed' | undefined;
    if (!session || Date.now() - session.at > SHOWN_TTL_MS) {
      session = { sig: '', plan: EMPTY_PLAN, planByAi: false, shown: new Set(), pending: [], cursors: {}, exhausted: false, generated: false, keywordIds: [], requiredKeywordIds: [], at: Date.now() };
      this.sessions.set(sessionKey, session);
    }
    // o cliente também manda o que já mostrou (sobrevive a reinício da API)
    for (const k of ctx.exclude) session.shown.add(k);

    if (session.sig !== sig) {
      // nova revisão: plano, estoque e páginas zeram; o que já foi mostrado continua fora
      let plan = ctx.mood ? localPlan(ctx.mood) : EMPTY_PLAN;
      let planByAi = false;
      if (ctx.mood && plan.unmapped.length > 0 && ctx.aiAllowed && this.ai) {
        const ai = this.ai;
        const mood = ctx.mood;
        const res = await withAiUsage(userId, 'tonight_plan', () => ai.planRequest(mood, userId));
        if (res.ok) {
          plan = res.value;
          planByAi = true;
          aiUsed = true;
        } else failed = res.reason === 'quota' ? 'quota' : 'failed';
      }
      plan = withSelectedGenre(plan, ctx.genreKey);
      Object.assign(session, { sig, plan, planByAi, pending: [], cursors: {}, exhausted: false, generated: false, at: Date.now() });
      const required = requiredAttrs(plan);
      if (plan.references?.length && this.tmdb) {
        const related = await this.referenceCandidates(userId, plan, req.kind);
        for (const k of related.referenceKeys) session.shown.add(k);
        session.referenceTitles = related.titles;
        session.related = related.candidates;
      } else {
        session.referenceTitles = [];
        session.related = [];
      }
      session.keywordIds = await this.resolveKeywords(plan.prefer.filter((a) => !required.includes(a)));
      session.requiredKeywordIds = await this.resolveKeywords(required);
      const list = req.includeQueue === false ? [] : await this.listCandidates(userId, plan, req.kind, session.requiredKeywordIds);
      session.pending = [...list, ...session.related];
      session.pending.sort(compareCandidates);
    }
    const s = session;
    const plan = s.plan;
    const medias: ('movie' | 'tv')[] = req.kind === 'movie' ? ['movie'] : req.kind === 'series' ? ['tv'] : ['movie', 'tv'];
    const providerIds = ctx.filterSubs.flatMap((k) => PROVIDER_TMDB_IDS[k] ?? []);
    const softGenres = ctx.liked ?? (await this.likedGenres(userId));
    // "Incluir animes e animações?" desmarcado: nada de anime nem de animação (desenho), a não ser que
    // o pedido seja de animação
    const wantsAnimation = Boolean(req.includeAnime) || plan.genresAll.includes('animation') || plan.genresAny.includes('animation');
    // o que você evita (Perfil: "não curto"/"detesto"/excluído) fica de fora, a não ser que o pedido peça
    const asked = new Set<GenreKey>([...plan.genresAll, ...plan.genresAny]);
    const avoided = (ctx.hated ?? (await this.avoidedGenres(userId))).filter((g) => !asked.has(g));
    const retrievalPlan: TonightPlan = {
      ...plan,
      genresNone: [...new Set([...plan.genresNone, ...avoided, ...(wantsAnimation ? [] : ['animation' as GenreKey])])],
    };
    // "igual a X": a busca é por semelhança (IA + recomendações de X), não pela descoberta por gênero
    const referenceMode = Boolean(plan.references?.length);
    const required = requiredAttrs(plan);
    const usable = (c: Candidate) =>
      !s.shown.has(`${c.item.mediaType}:${c.item.tmdbId}`) &&
      // obrigatório só com prova (a sugestão da IA é conferida no TMDB e entra como "sugestão da IA")
      (c.source === 'ai' || required.every((a) => c.themes.includes(a))) &&
      (c.source === 'ai' || !plan.origins?.length || Boolean(c.originOk)) &&
      ctx.freshMedia({ ...c.item, anime: c.anime }) &&
      (wantsAnimation || (!c.anime && !c.genres.includes('animation'))) &&
      (!referenceMode || c.source === 'ai' || Boolean(c.similarTo)) &&
      planAccepts(retrievalPlan, c.genres);

    // repõe o estoque de descobertas quando está baixo (páginas novas, com orçamento)
    let budget = PAGE_BUDGET;
    const refill = async () => {
      if (!this.tmdb || s.exhausted || referenceMode) return;
      const sources: Exclude<Source, 'list' | 'ai'>[] = ['best', 'theme', 'recent'];
      let any = false;
      for (const media of medias) {
        for (const source of sources) {
          if (budget <= 0) return;
          const key = `${media}:${source}`;
          if (s.cursors[key] === -1) continue;
          const page = (s.cursors[key] ?? 0) + 1;
          // tema comprovado: a busca foi pela palavra-chave dele (obrigatórios entram em toda fonte)
          const themes = [...(source === 'theme' ? plan.prefer.filter((a) => ATTRIBUTES[a].keywords.length > 0 && !required.includes(a)) : []), ...required];
          const q: DiscoverQuery = { media, source, page, themes };
          const params = discoverParams(q, retrievalPlan, { providerIds, keywordIds: s.keywordIds, softGenres, requiredKeywordIds: s.requiredKeywordIds });
          if (!params) {
            s.cursors[key] = -1;
            continue;
          }
          budget--;
          const hits = await this.tmdb.discoverBrowse(media, params).catch(() => [] as TmdbHit[]);
          s.cursors[key] = hits.length ? page : -1;
          if (!hits.length) continue;
          any = true;
          const known = new Set(s.pending.map((c) => `${c.item.mediaType}:${c.item.tmdbId}`));
          const fresh = hits.filter((h) => !known.has(`${h.mediaType}:${h.tmdbId}`));
          const items = await this.search.toResults(userId, fresh, 'browse', fresh.length);
          const byKey = new Map(fresh.map((h) => [`${h.mediaType}:${h.tmdbId}`, h]));
          for (const item of items) {
            const h = byKey.get(`${item.mediaType}:${item.tmdbId}`)!;
            const runtimeOk = media === 'movie' && planMaxRuntime(plan) !== undefined;
            // a busca já filtrou pelo país de origem pedido
            const originOk = originCountries(plan).length > 0;
            s.pending.push(rate({ item, source, page, anime: isAnime(h), genres: hitGenres(h), themes, ...(runtimeOk ? { runtimeOk } : {}), ...(originOk ? { originOk } : {}) }, plan));
          }
        }
      }
      if (!any && Object.values(s.cursors).every((v) => v === -1)) s.exhausted = true;
      // Minha Área primeiro; depois pedido, perfil e desempate (sort estável: a fila mantém a ordem)
      s.pending.sort(compareCandidates);
    };

    const picked: TonightItem[] = [];
    const serve = async () => {
      while (picked.length < TONIGHT_SIZE) {
        // um título por franquia no lote (os outros continuam no estoque para "Novas sugestões")
        const franchises = new Set(picked.map((x) => franchiseKey(x.title)));
        const next = s.pending.filter(usable).filter((c) => {
          const f = franchiseKey(c.item.title);
          if (franchises.has(f)) return false;
          franchises.add(f);
          return true;
        });
        if (next.length === 0) return;
        // lista: mostra mesmo fora dos streamings (você já escolheu); descoberta: só nos streamings
        const head = next.slice(0, TONIGHT_SIZE - picked.length + 4);
        const checked = await this.checkAvailability(head.map((c) => c.item), ctx.filterSubs);
        for (const c of head) {
          const key = `${c.item.mediaType}:${c.item.tmdbId}`;
          s.pending = s.pending.filter((x) => x !== c);
          const on = checked.get(key);
          const fits = c.source === 'list' || !ctx.filterSubs.length || (on?.mine.length ?? 0) > 0;
          if (!fits || picked.length >= TONIGHT_SIZE) {
            if (fits) s.pending.unshift(c);
            continue;
          }
          s.shown.add(key);
          picked.push({
            ...c.item,
            availableOn: (ctx.filterSubs.length && c.source !== 'list' ? on?.mine : on?.all) ?? [],
            // sugestão da IA com o "por que lembra" dela (marcado como da IA); o resto, só com evidência
            aiReason: c.source === 'ai' && (c.item as { aiReason?: string }).aiReason ? `IA: ${(c.item as { aiReason?: string }).aiReason}` : reasonFor(c, plan),
            fit: Math.round(c.fit * 100),
            profileFit: Math.round(c.profile * 100),
            ...(c.source === 'list' ? { fromList: true } : {}),
          });
        }
      }
    };

    // a IA sugere nomes uma vez por pedido, conferidos com rigor no TMDB. Em "igual a X" ela vem
    // primeiro (comparar premissa é o que ela faz melhor); nos outros pedidos, só completa o que faltou
    const generate = async () => {
      if (s.generated || !ctx.aiAllowed || !this.ai || !(ctx.mood || !planIsEmpty(plan))) return;
      s.generated = true;
      const history = await this.seenSample(userId, [...plan.genresAll, ...plan.genresAny]);
      const brief: TasteBrief = { ...ctx.brief, seen: history.sample, seenCount: history.total, ...(ctx.mood ? { mood: ctx.mood } : {}) };
      const ai = this.ai;
      const kindHint = req.kind === 'movie' || req.kind === 'series' ? req.kind : undefined;
      const res = await withAiUsage(userId, 'tonight_titles', () =>
        ai.tonight(brief, userId, kindHint, {
          filtered: ctx.filterSubs.length > 0,
          max: AI_CANDIDATES,
          ...(referenceMode ? { references: s.referenceTitles?.length ? s.referenceTitles : plan.references, avoidGenres: avoided.map((g) => GENRE_LABEL.get(g) ?? g) } : {}),
        }),
      );
      if (res.ok) {
        aiUsed = true;
        const guesses = res.value.picks.flatMap((g) =>
          g.kind === 'movie' || g.kind === 'series' ? [{ title: g.title, kind: g.kind, ...(g.year ? { year: g.year } : {}), ...(g.reason ? { reason: g.reason } : {}) }] : [],
        );
        const { items } = await this.search.confirmGuesses(userId, guesses, {
          matchedBy: 'description',
          ...(kindHint ? { kind: kindHint } : {}),
          limit: AI_CANDIDATES,
        });
        const known = new Map(s.pending.map((c) => [`${c.item.mediaType}:${c.item.tmdbId}`, c]));
        for (const item of items) {
          const k = `${item.mediaType}:${item.tmdbId}`;
          const same = known.get(k);
          // a IA confirmou um que já estava no estoque (lista/recomendação): fica como sugestão da IA
          if (same) s.pending = s.pending.filter((c) => c !== same);
          // gêneros vêm do resultado conferido (sem gêneros no resultado, o plano não filtra por eles)
          s.pending.push(rate({ item, source: 'ai', page: 1, anime: Boolean(item.anime), genres: (item.genres ?? []) as GenreKey[], themes: [], ...(same?.similarTo ? { similarTo: same.similarTo } : {}) }, plan));
        }
        s.pending.sort(compareCandidates);
      } else failed ??= res.reason === 'quota' ? 'quota' : 'failed';
    };

    if (referenceMode) await generate();
    if (s.pending.filter(usable).length < STOCK_LOW) await refill();
    await serve();
    if (picked.length < TONIGHT_SIZE && !s.exhausted) {
      await refill();
      await serve();
    }
    if (picked.length < TONIGHT_SIZE) {
      await generate();
      await serve();
    }

    s.at = Date.now();
    const remaining = s.pending.filter(usable).length;
    return {
      picked,
      aiUsed: aiUsed || s.planByAi,
      ...(planIsEmpty(plan) ? {} : { understood: planLabel(plan, (g) => GENRE_LABEL.get(g) ?? g) }),
      ...(plan.unmapped.length && !s.planByAi ? { unmapped: plan.unmapped } : {}),
      exhausted: picked.length < TONIGHT_SIZE && remaining === 0 && s.exhausted,
      ...(failed ? { failed } : {}),
    };
  }

  /**
   * Prateleiras da tela: lançamentos, ação e ficção científica, populares nos seus streamings (sem
   * streaming cadastrado, o que está em assinatura no Brasil), sem o que você já assistiu/abandonou.
   * Filmes e séries intercalados por popularidade. Cache de 1 h por usuário e streamings.
   */
  async shelves(userId: string): Promise<TonightShelvesResponse> {
    const setup = await this.shelfSetup(userId);
    if (!setup.tmdb) return { services: setup.services, shelves: [] };
    const cacheKey = `${userId}:${[...setup.subs].sort().join(',')}`;
    const cached = this.shelfCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SHELF_TTL_MS) return cached.value;

    const shelves = await Promise.all(setup.defs.map(async (d) => ({ key: d.key, label: d.label, ...(await this.shelfPageItems(userId, setup, d, 1)) })));
    // cada título numa prateleira só (a primeira em que aparece: lançamentos, ação, ficção científica)
    const used = new Set<string>();
    for (const shelf of shelves) {
      shelf.items = shelf.items.filter((it) => {
        const k = `${it.mediaType}:${it.tmdbId}`;
        if (used.has(k)) return false;
        used.add(k);
        return true;
      });
    }
    const value = {
      services: setup.services,
      shelves: shelves.filter((s) => s.items.length > 0).map((s) => ({ key: s.key, label: s.label, items: s.items, hasMore: s.hasMore })),
    };
    this.shelfCache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

  /** Rolagem infinita: a página seguinte de uma prateleira (mesmos filtros, página seguinte do TMDB). */
  async shelfPage(userId: string, key: TonightShelfKey, page: number): Promise<TonightShelfPageResponse> {
    const setup = await this.shelfSetup(userId);
    const def = setup.defs.find((d) => d.key === key);
    if (!setup.tmdb || !def) return { items: [], hasMore: false };
    return this.shelfPageItems(userId, setup, def, page);
  }

  /** O que as prateleiras precisam: seus streamings, o que você ocultou e as regras de cada uma. */
  private async shelfSetup(userId: string) {
    const { subs, hidden } = await withUser(this.db, userId, async (tx) => ({
      subs: (await tx.select().from(userSubscriptions)).map((r) => r.provider).filter((p) => PROVIDER_TMDB_IDS[p]),
      hidden: await this.hiddenKeys(tx),
    }));
    const services = subs.map((k) => PROVIDER_LABEL.get(k) ?? k);
    const providerIds = subs.flatMap((k) => PROVIDER_TMDB_IDS[k] ?? []);
    const where = providerIds.length ? { providerIds } : { availableBR: true };
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    // o que você evita (níveis "não curto"/"detesto" ou excluídos) não aparece nas prateleiras
    const avoided = this.tmdb ? (await this.defaults(userId)).genres.filter((g) => g.group === 'avoid').map((g) => g.key as GenreKey) : [];
    const noise = (m: ShelfMedia) => [...new Set([...SHELF_NOISE[m], ...tmdbGenreIds(avoided, m)])];
    const scifiTv = await this.keywordIdsByName(SCIFI_TV_KEYWORDS);
    const curated = { fromDate: day(365 * SHELF_RECENT_YEARS), minVotes: SHELF_MIN_VOTES, minRating: SHELF_MIN_RATING };
    const defs: ShelfDef[] = [
      // estreias dos últimos meses (série: estreia da 1ª temporada), já com algum voto
      { key: 'new', label: 'Lançamentos', params: (m) => ({ ...where, sort: 'popular', fromDate: day(m === 'movie' ? 120 : 180), toDate: day(0), minVotes: 10, withoutGenreIds: noise(m) }) },
      { key: 'action', label: 'Ação', params: (m) => ({ ...where, ...curated, sort: 'popular', genreIds: tmdbGenreIds(['action'], m), withoutGenreIds: noise(m) }) },
      {
        key: 'scifi',
        label: 'Ficção científica',
        params: (m) => ({
          ...where,
          ...curated,
          sort: 'popular',
          genreIds: tmdbGenreIds(['scifi'], m),
          withoutGenreIds: noise(m),
          ...(m === 'tv' && scifiTv.length ? { keywordIds: scifiTv } : {}),
        }),
      },
    ];
    return { tmdb: this.tmdb, subs, hidden, services, defs };
  }

  /** Uma página de uma prateleira: filmes e séries intercalados, sem o que já viu/ocultou, com onde assistir. */
  private async shelfPageItems(
    userId: string,
    setup: { tmdb: TmdbResolver | null; subs: string[]; hidden: Set<string> },
    def: ShelfDef,
    page: number,
  ): Promise<TonightShelfPageResponse> {
    const tmdb = setup.tmdb!;
    const [movies, tv] = await Promise.all((['movie', 'tv'] as const).map((m) => tmdb.discoverBrowse(m, { ...def.params(m), page }).catch(() => [] as TmdbHit[])));
    // intercala filme e série (cada lista já vem por popularidade)
    const mixed: TmdbHit[] = [];
    for (let i = 0; i < Math.max(movies!.length, tv!.length); i++) {
      if (movies![i]) mixed.push(movies![i]!);
      if (tv![i]) mixed.push(tv![i]!);
    }
    const hasMore = mixed.length > 0 && page < SHELF_MAX_PAGES;
    if (!mixed.length) return { items: [], hasMore: false };
    const order = new Map(mixed.map((h, i) => [`${h.mediaType}:${h.tmdbId}`, i]));
    const items = (await this.search.toResults(userId, mixed, 'browse', mixed.length))
      // só o que você não assistiu, não abandonou e não mandou ocultar (−)
      .filter((it) => it.inLibrary?.status !== 'watched' && it.inLibrary?.status !== 'dropped' && !it.anime && !setup.hidden.has(`${it.mediaType}:${it.tmdbId}`))
      .sort((a, b) => order.get(`${a.mediaType}:${a.tmdbId}`)! - order.get(`${b.mediaType}:${b.tmdbId}`)!);
    // onde assistir em cada cartaz (cache de disponibilidade de 6 h, compartilhado com a busca)
    const onAir = await this.checkAvailability(items, setup.subs);
    return {
      hasMore,
      items: items.map((it) => {
        const on = onAir.get(`${it.mediaType}:${it.tmdbId}`);
        const list = (setup.subs.length ? on?.mine : on?.all) ?? [];
        return list.length ? { ...it, availableOn: list } : it;
      }),
    };
  }

  /**
   * "Igual a X": acha X no TMDB (o tipo pedido, se houver) e traz as recomendações e semelhantes dele.
   * X sai do resultado (você já conhece). Nada disso vai à IA além do nome que você mesmo digitou.
   */
  private async referenceCandidates(userId: string, plan: TonightPlan, kind?: TonightKind) {
    const tmdb = this.tmdb!;
    const media = kind === 'movie' ? 'movie' : kind === 'series' ? 'tv' : undefined;
    const refs = (
      await Promise.all(
        (plan.references ?? []).slice(0, 2).map(async (r) => {
          const titles = (await tmdb.searchMulti(r).catch(() => null))?.titles ?? [];
          const norm = normTitle(r);
          return titles.find((h) => normTitle(h.title) === norm || normTitle(h.originalTitle ?? '') === norm) ?? titles[0] ?? null;
        }),
      )
    ).filter((h): h is TmdbHit => h !== null);
    const candidates: Candidate[] = [];
    for (const ref of refs) {
      const related = (await tmdb.relatedTo(ref.mediaType, ref.tmdbId).catch(() => [] as TmdbHit[])).filter((h) => !media || h.mediaType === media);
      if (!related.length) continue;
      const items = await this.search.toResults(userId, related, 'browse', related.length);
      const byKey = new Map(related.map((h) => [`${h.mediaType}:${h.tmdbId}`, h]));
      for (const item of items) {
        const h = byKey.get(`${item.mediaType}:${item.tmdbId}`)!;
        candidates.push(rate({ item, source: 'similar', page: 1, anime: isAnime(h), genres: hitGenres(h), themes: [], similarTo: ref.title }, plan));
      }
    }
    return { referenceKeys: refs.map((r) => `${r.mediaType}:${r.tmdbId}`), titles: refs.map((r) => `${r.title}${r.year ? ` (${r.year})` : ''}`), candidates };
  }

  /** Gêneros que você evita (Perfil: "não curto", "detesto" ou excluído). */
  private async avoidedGenres(userId: string): Promise<GenreKey[]> {
    return (await this.defaults(userId)).genres.filter((g) => g.group === 'avoid').map((g) => g.key as GenreKey);
  }

  /** "Não mostrar mais" (−): grava e tira das prateleiras já montadas deste usuário. */
  async hide(userId: string, req: TonightHideRequest): Promise<void> {
    await withUser(this.db, userId, (tx) => tx.insert(tonightHidden).values({ userId, mediaType: req.mediaType, tmdbId: req.tmdbId }).onConflictDoNothing());
    const key = `${req.mediaType}:${req.tmdbId}`;
    for (const [k, v] of this.shelfCache) {
      if (!k.startsWith(`${userId}:`)) continue;
      v.value = { ...v.value, shelves: v.value.shelves.map((s) => ({ ...s, items: s.items.filter((it) => `${it.mediaType}:${it.tmdbId}` !== key) })) };
    }
  }

  private async hiddenKeys(tx: Tx): Promise<Set<string>> {
    const rows = await tx.select({ mediaType: tonightHidden.mediaType, tmdbId: tonightHidden.tmdbId }).from(tonightHidden);
    return new Set(rows.map((r) => `${r.mediaType}:${r.tmdbId}`));
  }

  /** Amostra do que você já viu (assistido/abandonado), dos gêneros da busca, e quantos já viu. */
  private async seenSample(userId: string, genres: GenreKey[]): Promise<{ sample: { title: string; year?: number }[]; total: number }> {
    return withUser(this.db, userId, async (tx) => {
      const seen = inArray(recommendations.status, ['watched', 'dropped']);
      const video = inArray(recommendations.kind, ['movie', 'series']);
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(recommendations).where(and(eq(recommendations.status, 'watched'), video));
      const rows = await tx
        .select({ title: recommendations.title, year: recommendations.year })
        .from(recommendations)
        .where(and(seen, video, ...(genres.length ? [arrayOverlaps(recommendations.genres, genres)] : [])))
        .orderBy(desc(recommendations.updatedAt))
        .limit(SEEN_SAMPLE);
      return { sample: rows.map((r) => ({ title: r.title, ...(r.year ? { year: r.year } : {}) })), total: Number(n) };
    });
  }

  /** Minha Área (Quero assistir / Assistindo) que atende ao plano, na ordem da fila. */
  private async listCandidates(userId: string, plan: TonightPlan, kind?: TonightKind, requiredKeywordIds: number[] = []): Promise<Candidate[]> {
    const required = requiredAttrs(plan);
    if (required.length && !requiredKeywordIds.length) return [];
    const rows = await withUser(this.db, userId, (tx) =>
      tx
        .select({ resolution: recommendations.resolution, rank: recommendations.rank, kind: recommendations.kind, genres: recommendations.genres })
        .from(recommendations)
        .where(and(inArray(recommendations.status, ['to_watch', 'watching']), inArray(recommendations.kind, kind === 'movie' ? ['movie'] : kind === 'series' ? ['series'] : ['movie', 'series'])))
        .orderBy(asc(recommendations.rank)),
    );
    const hits: { hit: TmdbHit; genres: GenreKey[] }[] = [];
    for (const r of rows) {
      const res = r.resolution;
      if (!res || res.provider !== 'tmdb' || !res.tmdbId || !res.mediaType) continue;
      const genres = (r.genres ?? []).filter((g): g is GenreKey => GENRE_LABEL.has(g));
      if (!planAccepts(plan, genres)) continue;
      hits.push({
        genres,
        hit: {
          tmdbId: res.tmdbId,
          mediaType: res.mediaType,
          title: res.title,
          ...(res.year ? { year: res.year } : {}),
          ...(res.imageUrl ? { posterUrl: res.imageUrl } : {}),
          popularity: 0,
          genreIds: res.genreIds ?? [],
          ...(res.voteAverage != null ? { voteAverage: res.voteAverage } : {}),
          ...(res.voteCount != null ? { voteCount: res.voteCount } : {}),
        },
      });
    }
    if (!hits.length || !this.tmdb) return [];
    // origem pedida ("nórdico"): só fica o que o TMDB comprova pelo país da obra
    const countries = new Set(originCountries(plan));
    if (countries.size) {
      const kept = await Promise.all(hits.map(async (h) => ((await this.countriesOfTitle(h.hit.mediaType, h.hit.tmdbId)).some((c) => countries.has(c)) ? h : null)));
      hits.splice(0, hits.length, ...kept.filter((h): h is (typeof hits)[number] => h !== null));
      if (!hits.length) return [];
    }
    // atributo obrigatório: só fica o que o TMDB comprova pelas palavras-chave da obra
    if (required.length) {
      const want = new Set(requiredKeywordIds);
      const kept = await Promise.all(hits.map(async (h) => ((await this.keywordsOf(h.hit.mediaType, h.hit.tmdbId)).some((id) => want.has(id)) ? h : null)));
      hits.splice(0, hits.length, ...kept.filter((h): h is (typeof hits)[number] => h !== null));
      if (!hits.length) return [];
    }
    const items = await this.search.toResults(userId, hits.map((h) => h.hit), 'title', hits.length);
    const genresOf = new Map(hits.map((h) => [`${h.hit.mediaType}:${h.hit.tmdbId}`, h.genres]));
    // fila na ordem dela; o sort estável depois ordena pelo pedido mantendo essa ordem nos empates
    return items
      .map((item) => rate({ item, source: 'list', page: 1, anime: false, genres: genresOf.get(`${item.mediaType}:${item.tmdbId}`) ?? [], themes: required, ...(countries.size ? { originOk: true } : {}) }, plan))
      .sort(compareCandidates);
  }

  /** IDs do TMDB das palavras-chave dos atributos pedidos (resolvidos pelo nome, com cache). */
  /** Países de uma obra (cache igual ao da disponibilidade). Falha = nenhum (fail-closed). */
  private async countriesOfTitle(media: 'movie' | 'tv', id: number): Promise<string[]> {
    const key = `${media}:${id}`;
    const hit = this.titleCountries.get(key);
    if (hit && Date.now() - hit.at < AVAILABILITY_TTL_MS) return hit.ids;
    const ids = await this.tmdb!.countriesOf(media, id).catch(() => [] as string[]);
    this.titleCountries.set(key, { ids, at: Date.now() });
    return ids;
  }

  /** Palavras-chave de uma obra (cache igual ao da disponibilidade). Falha = nenhuma (fail-closed). */
  private async keywordsOf(media: 'movie' | 'tv', id: number): Promise<number[]> {
    const key = `${media}:${id}`;
    const hit = this.titleKeywords.get(key);
    if (hit && Date.now() - hit.at < AVAILABILITY_TTL_MS) return hit.ids;
    const ids = await this.tmdb!.keywordIdsOf(media, id).catch(() => [] as number[]);
    this.titleKeywords.set(key, { ids, at: Date.now() });
    return ids;
  }

  /** IDs de palavras-chave pelo nome exato (cache do serviço). */
  private async keywordIdsByName(names: string[]): Promise<number[]> {
    if (!this.tmdb) return [];
    const ids = await Promise.all(
      names.map(async (n) => {
        if (!this.keywordIds.has(n)) {
          const id = await this.tmdb!.searchKeyword(n).catch(() => undefined);
          // falha de rede não fica guardada (tenta de novo na próxima); "não existe" fica
          if (id === undefined) return null;
          this.keywordIds.set(n, id);
        }
        return this.keywordIds.get(n) ?? null;
      }),
    );
    return ids.filter((x): x is number => x != null);
  }

  private async resolveKeywords(attrs: Attr[]): Promise<number[]> {
    return this.keywordIdsByName([...new Set(attrs.flatMap((a) => [...ATTRIBUTES[a].keywords]))]);
  }

  private async likedGenres(userId: string): Promise<GenreKey[]> {
    const overrides = await withUser(this.db, userId, (tx) => tx.select().from(tasteOverrides));
    return overrides.filter((o) => overrideScore(o) >= 0.25).map((o) => o.genre as GenreKey);
  }

  /**
   * Onde assistir (assinatura no Brasil) dos finalistas, com cache. `mine` = nos streamings
   * escolhidos; `all` = em qualquer streaming. Sem dado = disponibilidade não confirmada.
   */
  private async checkAvailability(items: TitleSearchResult[], subs: string[]): Promise<Map<string, { mine: string[]; all: string[] }>> {
    const out = new Map<string, { mine: string[]; all: string[] }>();
    if (!this.tmdb) return out;
    const tmdb = this.tmdb;
    const mineSet = new Set(subs);
    await Promise.all(
      items.map(async (it) => {
        const key = `${it.mediaType}:${it.tmdbId}`;
        let cached = this.availability.get(key);
        if (!cached || Date.now() - cached.at > AVAILABILITY_TTL_MS) {
          const d = await tmdb.byId(it.mediaType, it.tmdbId, undefined, { titleLinks: false }).catch(() => null);
          cached = { providers: (d?.providers ?? []).map((p) => ({ ...(p.key ? { key: p.key } : {}), name: p.name, type: p.type })), at: Date.now() };
          this.availability.set(key, cached);
        }
        const flat = cached.providers.filter((p) => p.type === 'flatrate');
        const label = (p: { key?: string; name: string }) => (p.key ? (PROVIDER_LABEL.get(p.key) ?? p.name) : p.name);
        out.set(key, {
          mine: [...new Set(flat.filter((p) => p.key && mineSet.has(p.key)).map(label))].slice(0, 4),
          all: [...new Set(flat.map(label))].slice(0, 4),
        });
      }),
    );
    return out;
  }

  /** "Já assisti / já li / já ouvi": o título entra (ou fica) na sua lista como consumido e não volta. */
  async markWatched(userId: string, req: TonightWatchedRequest): Promise<Title> {
    if ('tmdbId' in req) {
      for (const [k, sess] of this.sessions) if (k.startsWith(`${userId}:`)) sess.shown.add(`${req.mediaType}:${req.tmdbId}`);
    }
    if ('music' in req) {
      const m = req.music;
      return this.catalog.createTitle(userId, { title: m.title, kind: m.kind, ...(m.artist ? { creator: m.artist } : {}), status: 'watched' }).catch(async (err: unknown) => {
        // já estava na lista: só marca como ouvido
        const [row] = await withUser(this.db, userId, (tx) =>
          tx.select({ id: recommendations.id }).from(recommendations).where(inArray(recommendations.title, [m.title])).limit(1),
        );
        if (!row) throw err;
        return this.library.update(userId, row.id, { status: 'watched' });
      });
    }
    const res = await this.search.import(userId, 'olWorkId' in req ? { items: [], books: [{ olWorkId: req.olWorkId }] } : { items: [{ tmdbId: req.tmdbId, mediaType: req.mediaType }] });
    const id = res.created[0]?.id ?? res.skipped[0]?.existingId ?? res.skippedBooks?.[0]?.existingId;
    if (!id) throw new NotFoundException('Título não encontrado');
    return this.library.update(userId, id, { status: 'watched' });
  }

  private shownFor(userId: string): Map<string, { name: string; at: number }> {
    const now = Date.now();
    const m = this.shown.get(userId) ?? new Map<string, { name: string; at: number }>();
    for (const [k, v] of m) if (now - v.at > SHOWN_TTL_MS) m.delete(k);
    this.shown.set(userId, m);
    return m;
  }
}

const tooMany = () => new HttpException('Muitos pedidos em pouco tempo; espere um pouco', HttpStatus.TOO_MANY_REQUESTS);

/** chave estável de uma sugestão de música */
function slug(s: string): string {
  return normTitle(s).replace(/ /g, '-').slice(0, 80) || 'musica';
}

interface VideoSession {
  sig: string;
  plan: TonightPlan;
  planByAi: boolean;
  shown: Set<string>;
  pending: Candidate[];
  /** página já lida por fonte ("movie:best"); -1 = esgotada */
  cursors: Record<string, number>;
  exhausted: boolean;
  /** o gerador da IA já rodou nesta revisão */
  generated: boolean;
  keywordIds: number[];
  /** palavras-chave dos atributos obrigatórios ("história real"): só entra obra que tenha uma delas */
  requiredKeywordIds: number[];
  /** "igual a X": os títulos de X encontrados no TMDB e as recomendações/semelhantes deles */
  referenceTitles?: string[];
  related?: Candidate[];
  at: number;
}
