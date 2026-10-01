import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { SummaryDraft, Title, TonightDefaults, TonightRequest, TonightResponse, TonightWatchedRequest } from '@fruiqo/contracts';
import { detectRisk, GENRES, type GenreKey, genresFromTmdb, genreTermsIn, RISK_SUPPORT, SUBGENRES } from '@fruiqo/taxonomy';
import { and, arrayOverlaps, asc, count, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { DB, type Db, withUser } from '../db/client.js';
import { overrideScore, recommendations, tasteFavorites, tasteOverrides, tasteStatements, tasteSubgenrePrefs, userSubscriptions } from '../db/schema.js';
import type { TmdbHit, TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { CatalogService } from './catalog.service.js';
import { LibraryService } from './library.service.js';
import { PROVIDER_LABEL, STREAMING_PROVIDERS } from './providers.js';
import { tmdbGenreIds } from './search-query.js';
import { PerUserRateLimiter, SearchService } from './search.service.js';
import { BIG_HISTORY, briefIsEmpty, MAX_PICKS_LIMIT, TASTE_AI, type TasteAi, type TasteBrief, type TonightKind, type TonightPick } from './taste-ai.js';
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
/** quantos palpites da IA conferir no TMDB (sobram após tirar assistidos e o que não está nos seus serviços) */
const AI_CANDIDATES = MAX_PICKS_LIMIT;
/** amostra do que já viu, dos gêneros desta busca, enviada à IA como "não sugerir" */
const SEEN_SAMPLE = 30;
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
   * Estoque por busca: candidatos da IA já conferidos no TMDB e ainda não mostrados. "Novas
   * sugestões" com o mesmo pedido saem daqui, sem chamar a IA de novo.
   */
  private readonly pool = new Map<string, { sig: string; items: Omit<TonightItem, 'availableOn'>[]; request?: string; at: number }>();

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
    const res = await this.ai.improveSummary(text, userId);
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
    const { subs, favoriteKeys, favoriteTitles } = await withUser(this.db, userId, async (tx) => {
      const favorites = await tx.select({ tmdbId: tasteFavorites.tmdbId, mediaType: tasteFavorites.mediaType, olWorkId: tasteFavorites.olWorkId, title: tasteFavorites.title }).from(tasteFavorites);
      return {
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
    // o que foi pedido hoje manda: gêneros citados no texto ("ação... scifi") viram filtro obrigatório
    const asked = mood ? genreTermsIn(mood).genres.filter((g) => GENRE_LABEL.has(g)) : [];
    // nada do que você já assistiu/leu/ouviu, abandonou, marcou como favorito ou já viu nesta rodada
    const fresh = (key: string, titles: (string | undefined)[], status?: string) =>
      status !== 'watched' &&
      status !== 'dropped' &&
      !favoriteKeys.has(key) &&
      !titles.some((t) => t && favoriteTitles.has(normTitle(t))) &&
      !exclude.has(key);
    const freshMedia = (it: { mediaType: string; tmdbId: number; title: string; originalTitle?: string; anime?: boolean; inLibrary: { status?: string } | null }) =>
      (req.includeAnime || !it.anime) && fresh(`${it.mediaType}:${it.tmdbId}`, [it.title, it.originalTitle], it.inLibrary?.status);

    // 1) IA (com consentimento): filmes/séries e livros conferidos depois
    let unavailable: TonightResponse['unavailable'];
    let aiUsed = false;
    let request: string | undefined;
    let picked: TonightItem[] = [];
    let books: NonNullable<TonightResponse['books']> | undefined;
    let music: NonNullable<TonightResponse['music']> | undefined;
    const sig = JSON.stringify({ kind: kind ?? null, genre: req.genre ?? null, mood: mood ?? null, subs: [...filterSubs].sort(), profile: req.profile ?? null, anime: Boolean(req.includeAnime) });
    // "novas sugestões" com o mesmo pedido: primeiro o estoque da busca anterior (sem IA)
    const stock = video ? this.poolFor(userId, sig) : undefined;
    if (stock && stock.items.length > 0) {
      const fromStock = await this.withAvailability(stock.items.filter(freshMedia), filterSubs, TONIGHT_SIZE);
      picked = fromStock.out;
      stock.items = fromStock.rest;
      aiUsed = picked.length > 0;
      request = stock.request;
    }
    if (picked.length >= TONIGHT_SIZE) {
      // o estoque bastou
    } else if (!this.ai) unavailable = 'disabled';
    else if (!(await userAllowsAi(this.db, userId))) unavailable = 'consent';
    else if (briefIsEmpty(brief)) unavailable = 'no_profile';
    else if (video) {
      // histórico: amostra do que já viu nos gêneros desta busca + tamanho (grande = menos óbvios)
      const wantedGenres = asked.length ? asked : genreKey ? [genreKey] : (override?.liked ?? []);
      const history = await this.seenSample(userId, wantedGenres);
      // um perfil por rodada (a 2ª ganha o que aprendeu na 1ª), sem alterar o anterior
      let roundBrief: TasteBrief = { ...brief, seen: history.sample, seenCount: history.total };
      const max = history.total >= BIG_HISTORY ? MAX_PICKS_LIMIT : filterSubs.length > 0 ? 15 : 10;
      const kindFilter = kind === 'movie' || kind === 'series' ? { kind } : {};
      // até duas rodadas: na 2ª, a IA sabe o que ela sugeriu e você já tinha visto (ou não está nos seus serviços)
      for (let round = 0; round < 2 && picked.length < TONIGHT_SIZE; round++) {
        const res = await this.ai.tonight(roundBrief, userId, kind, { filtered: filterSubs.length > 0, max });
        if (!res.ok) {
          if (!aiUsed) unavailable = res.reason === 'too_long' ? 'failed' : res.reason;
          break;
        }
        aiUsed = true;
        request ??= res.value.request;
        const guesses = res.value.picks.flatMap((g: TonightPick) =>
          g.kind === 'movie' || g.kind === 'series' ? [{ title: g.title, kind: g.kind, ...(g.year ? { year: g.year } : {}), reason: g.reason }] : [],
        );
        const { items } = await this.search.confirmGuesses(userId, guesses, { matchedBy: 'description', ...kindFilter, limit: AI_CANDIDATES });
        const taken = new Set(picked.map((x) => `${x.mediaType}:${x.tmdbId}`));
        const candidates = items.filter((it) => freshMedia(it) && !taken.has(`${it.mediaType}:${it.tmdbId}`));
        const got = await this.withAvailability(candidates, filterSubs, TONIGHT_SIZE - picked.length);
        picked = [...picked, ...got.out];
        // o que sobrou (ainda não conferido) vira estoque para "novas sugestões"
        this.pool.set(userId, { sig, items: got.rest, ...(request ? { request } : {}), at: Date.now() });
        // aprendizado para a 2ª rodada: o que ela sugeriu e não serviu
        const notFresh = items.filter((it) => !freshMedia(it));
        roundBrief = {
          ...roundBrief,
          avoid: [...roundBrief.avoid, ...[...notFresh, ...got.rejected, ...got.out].map((it) => `${it.title}${it.year ? ` (${it.year})` : ''}`)],
        };
        if (got.rest.length > 0) break; // sobrou estoque: não precisa de outra rodada
      }
    } else {
      const res = await this.ai.tonight(brief, userId, kind);
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
              aiReason: x.reason,
            }))
            .filter((m) => fresh(m.key, [m.title]))
            .slice(0, TONIGHT_SIZE);
        }
      }
    }

    // 2) filme/série: faltou (ou sem IA), busca local nos seus serviços, pelo gênero pedido ou os que você marcou
    if (video && picked.length < TONIGHT_SIZE && this.tmdb) {
      const taken = new Set(picked.map((p) => `${p.mediaType}:${p.tmdbId}`));
      const local = await this.localPicks(userId, kind === 'movie' || kind === 'series' ? kind : undefined, filterSubs, genreKey, override, asked);
      const more = local.filter((it) => freshMedia(it) && !taken.has(`${it.mediaType}:${it.tmdbId}`));
      picked = [...picked, ...(await this.withAvailability(more, filterSubs, TONIGHT_SIZE - picked.length)).out];
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
      services,
      items: picked,
      ...(books ? { books } : {}),
      ...(music ? { music } : {}),
    };
  }

  /**
   * Onde assistir (TMDB, assinatura no Brasil) de cada candidato, em ordem, até `want` títulos. Com
   * serviços (`subs`), só fica o que está em algum deles; sem serviços, não filtra e mostra todos.
   */
  private async withAvailability(
    items: Omit<TonightItem, 'availableOn'>[],
    subs: string[],
    want: number,
  ): Promise<{ out: TonightItem[]; rejected: Omit<TonightItem, 'availableOn'>[]; rest: Omit<TonightItem, 'availableOn'>[] }> {
    if (!this.tmdb) return { out: items.slice(0, want).map((it) => ({ ...it, availableOn: [] })), rejected: [], rest: items.slice(want) };
    const tmdb = this.tmdb;
    const mine = new Set(subs);
    const filtering = subs.length > 0;
    const out: TonightItem[] = [];
    const rejected: Omit<TonightItem, 'availableOn'>[] = [];
    const restLater: Omit<TonightItem, 'availableOn'>[] = [];
    let i = 0;
    // em lotes, para não consultar mais do que o necessário
    for (; i < items.length && out.length < want; i += 4) {
      const batch = items.slice(i, i + 4);
      const details = await Promise.all(batch.map((it) => tmdb.byId(it.mediaType, it.tmdbId, undefined, { titleLinks: false }).catch(() => null)));
      batch.forEach((it, j) => {
        const on = [
          ...new Set(
            (details[j]?.providers ?? [])
              .filter((p) => p.type === 'flatrate' && (!filtering || (p.key && mine.has(p.key))))
              .map((p) => (p.key ? (PROVIDER_LABEL.get(p.key) ?? p.name) : p.name)),
          ),
        ].slice(0, 4);
        const fits = on.length > 0 || !filtering;
        if (!fits) rejected.push(it);
        else if (out.length < want) out.push({ ...it, availableOn: on });
        // conferido e serve, mas já há o bastante: volta para o estoque
        else restLater.push(it);
      });
    }
    return { out, rejected, rest: [...restLater, ...items.slice(i)] };
  }

  /** Amostra do que você já viu (assistido/abandonado), dos gêneros desta busca, e quantos já viu. */
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

  private poolFor(userId: string, sig: string) {
    const p = this.pool.get(userId);
    if (!p || p.sig !== sig || Date.now() - p.at > SHOWN_TTL_MS) return undefined;
    return p;
  }

  /**
   * Busca local (sem IA): mais bem avaliados nos seus serviços. Os gêneros citados no pedido de hoje
   * são obrigatórios (todos ao mesmo tempo); sem eles, o gênero escolhido; sem ele, os que você
   * marcou (qualquer um). O motivo só cita gênero que o título tem de fato.
   */
  private async localPicks(
    userId: string,
    kind: 'movie' | 'series' | undefined,
    subs: string[],
    genre?: GenreKey,
    override?: { liked: GenreKey[]; hated: GenreKey[] },
    asked: GenreKey[] = [],
  ): Promise<Omit<TonightItem, 'availableOn'>[]> {
    const tmdb = this.tmdb!;
    const overrides = override ? [] : await withUser(this.db, userId, (tx) => tx.select().from(tasteOverrides));
    const marked = override?.liked ?? overrides.filter((o) => overrideScore(o) >= 0.25).map((o) => o.genre as GenreKey);
    // pedido de hoje (todos) > gênero escolhido > os que você marcou (qualquer um)
    const required = asked.length > 0 ? [...new Set([...asked, ...(genre ? [genre] : [])])] : genre ? [genre] : [];
    const wanted = required.length > 0 ? required : marked;
    const all = required.length > 0;
    const hated = (override?.hated ?? overrides.filter((o) => o.mode === 'exclude').map((o) => o.genre as GenreKey)).filter((g) => !wanted.includes(g));
    const providerIds = subs.flatMap((k) => PROVIDER_TMDB_IDS[k] ?? []);
    const medias: ('movie' | 'tv')[] = kind === 'movie' ? ['movie'] : kind === 'series' ? ['tv'] : ['movie', 'tv'];
    // páginas 1 e 2 (uma página sorteada vinha vazia quando o filtro tinha poucos títulos); o que já
    // apareceu sai pelo `exclude`, então "novas sugestões" seguem para os próximos
    const lists = await Promise.all(
      medias.map(async (m) => {
        const ids = tmdbGenreIds(wanted, m);
        // gênero pedido sem equivalente nesse tipo (ex.: terror em série): esse tipo não serve
        if (all && wanted.some((g) => tmdbGenreIds([g], m).length === 0)) return [] as TmdbHit[];
        const pages = await Promise.all(
          [1, 2].map((page) =>
            tmdb
              .discoverBrowse(m, {
                sort: 'best',
                page,
                ...(providerIds.length ? { providerIds } : { availableBR: true }),
                ...(ids.length ? { genreIds: ids, anyGenre: !all } : {}),
                ...(hated.length ? { withoutGenreIds: tmdbGenreIds(hated, m) } : {}),
              })
              .catch(() => [] as TmdbHit[]),
          ),
        );
        return pages.flat();
      }),
    );
    // filmes e séries intercalados
    const mixed: TmdbHit[] = [];
    for (let i = 0; i < Math.max(...lists.map((l) => l.length), 0); i++) for (const l of lists) if (l[i]) mixed.push(l[i]!);
    const reasonOf = new Map(
      mixed.map((h) => {
        const has = Object.keys(genresFromTmdb(h.genreIds, h.mediaType)) as GenreKey[];
        const hit = wanted.filter((g) => has.includes(g)).map((g) => GENRE_LABEL.get(g)!.toLowerCase());
        const reason =
          all && hit.length > 0
            ? `Atende ao seu pedido: ${joinPt(hit)}; bem avaliado.`
            : hit.length > 0
              ? `Bem avaliado e de ${joinPt(hit)}, que você gosta.`
              : 'Entre os mais bem avaliados disponíveis para você.';
        return [`${h.mediaType}:${h.tmdbId}`, reason] as const;
      }),
    );
    return (await this.search.toResults(userId, mixed, 'browse', 40)).map((it) => ({ ...it, aiReason: reasonOf.get(`${it.mediaType}:${it.tmdbId}`) }));
  }

  /** "Já assisti / já li / já ouvi": o título entra (ou fica) na sua lista como consumido e não volta. */
  async markWatched(userId: string, req: TonightWatchedRequest): Promise<Title> {
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
