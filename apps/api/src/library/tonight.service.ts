import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { SummaryDraft, Title, TonightRequest, TonightResponse, TonightWatchedRequest } from '@fruiqo/contracts';
import { detectRisk, GENRES, type GenreKey, RISK_SUPPORT, SUBGENRES } from '@fruiqo/taxonomy';
import { asc, desc, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { DB, type Db, withUser } from '../db/client.js';
import { overrideScore, recommendations, tasteFavorites, tasteOverrides, tasteStatements, tasteSubgenrePrefs, userSubscriptions } from '../db/schema.js';
import type { TmdbHit, TmdbResolver } from '../pipeline/resolvers/tmdb.js';
import { CatalogService } from './catalog.service.js';
import { LibraryService } from './library.service.js';
import { PROVIDER_LABEL } from './providers.js';
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
/** quantos palpites da IA conferir no TMDB (sobram após tirar assistidos e o que não está nos seus serviços) */
const AI_CANDIDATES = 10;
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
    const services = video ? subs.map((k) => PROVIDER_LABEL.get(k) ?? k) : [];
    // nada do que você já assistiu/leu/ouviu, abandonou, marcou como favorito ou já viu nesta rodada
    const fresh = (key: string, titles: (string | undefined)[], status?: string) =>
      status !== 'watched' &&
      status !== 'dropped' &&
      !favoriteKeys.has(key) &&
      !titles.some((t) => t && favoriteTitles.has(normTitle(t))) &&
      !exclude.has(key);
    const freshMedia = (it: { mediaType: string; tmdbId: number; title: string; originalTitle?: string; inLibrary: { status?: string } | null }) =>
      fresh(`${it.mediaType}:${it.tmdbId}`, [it.title, it.originalTitle], it.inLibrary?.status);

    // 1) IA (com consentimento): melhora o pedido e sugere; filmes/séries e livros conferidos depois
    let unavailable: TonightResponse['unavailable'];
    let aiUsed = false;
    let request: string | undefined;
    let picked: TonightItem[] = [];
    let books: NonNullable<TonightResponse['books']> | undefined;
    let music: NonNullable<TonightResponse['music']> | undefined;
    if (!this.ai) unavailable = 'disabled';
    else if (!(await userAllowsAi(this.db, userId))) unavailable = 'consent';
    else if (briefIsEmpty(brief)) unavailable = 'no_profile';
    else {
      const res = await this.ai.tonight(brief, userId, kind);
      if (!res.ok) unavailable = res.reason === 'too_long' ? 'failed' : res.reason;
      else {
        aiUsed = true;
        request = res.value.request;
        const picks = res.value.picks;
        if (video) {
          const guesses = picks.flatMap((p) => (p.kind === 'movie' || p.kind === 'series' ? [{ title: p.title, kind: p.kind, ...(p.year ? { year: p.year } : {}), reason: p.reason }] : []));
          const { items } = await this.search.confirmGuesses(userId, guesses, {
            matchedBy: 'description',
            ...(kind === 'movie' || kind === 'series' ? { kind } : {}),
            limit: AI_CANDIDATES,
          });
          picked = await this.withAvailability(items.filter(freshMedia), subs, TONIGHT_SIZE);
        } else if (kind === 'book') {
          const found = await this.search.confirmBookGuesses(userId, picks.filter((p) => p.kind === 'book')).catch(() => []);
          books = found.filter((b) => fresh(`book:${b.olWorkId}`, [b.title], b.inLibrary?.status)).slice(0, TONIGHT_SIZE);
        } else {
          music = picks
            .filter((p) => p.kind === 'music_track' || p.kind === 'music_album' || p.kind === 'artist')
            .map((p) => ({
              key: `music:${slug(`${p.title} ${p.creator ?? ''}`)}`,
              title: p.title,
              ...(p.creator ? { artist: p.creator } : {}),
              kind: p.kind as 'music_track' | 'music_album' | 'artist',
              ...(p.year ? { year: p.year } : {}),
              aiReason: p.reason,
            }))
            .filter((m) => fresh(m.key, [m.title]))
            .slice(0, TONIGHT_SIZE);
        }
      }
    }

    // 2) filme/série: faltou (ou sem IA), busca local nos seus serviços, pelo gênero pedido ou os que você marcou
    if (video && picked.length < TONIGHT_SIZE && this.tmdb) {
      const taken = new Set(picked.map((p) => `${p.mediaType}:${p.tmdbId}`));
      const local = await this.localPicks(userId, kind === 'movie' || kind === 'series' ? kind : undefined, subs, genreKey);
      const more = local.filter((it) => freshMedia(it) && !taken.has(`${it.mediaType}:${it.tmdbId}`));
      picked = [...picked, ...(await this.withAvailability(more, subs, TONIGHT_SIZE - picked.length))];
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
   * serviços cadastrados, só fica o que está em algum deles; sem serviços, não filtra.
   */
  private async withAvailability(
    items: Omit<TonightItem, 'availableOn'>[],
    subs: string[],
    want: number,
  ): Promise<TonightItem[]> {
    if (subs.length === 0 || !this.tmdb) return items.slice(0, want).map((it) => ({ ...it, availableOn: [] }));
    const tmdb = this.tmdb;
    const mine = new Set(subs);
    const out: TonightItem[] = [];
    // em lotes, para não consultar mais do que o necessário
    for (let i = 0; i < items.length && out.length < want; i += 4) {
      const batch = items.slice(i, i + 4);
      const details = await Promise.all(batch.map((it) => tmdb.byId(it.mediaType, it.tmdbId, undefined, { titleLinks: false }).catch(() => null)));
      batch.forEach((it, j) => {
        const on = [
          ...new Set(
            (details[j]?.providers ?? [])
              .filter((p) => p.type === 'flatrate' && p.key && mine.has(p.key))
              .map((p) => PROVIDER_LABEL.get(p.key!) ?? p.name),
          ),
        ];
        if (on.length > 0 && out.length < want) out.push({ ...it, availableOn: on });
      });
    }
    return out;
  }

  /** Busca local (sem IA): mais bem avaliados nos seus serviços, nos gêneros que você adora/gosta. */
  private async localPicks(userId: string, kind: 'movie' | 'series' | undefined, subs: string[], genre?: GenreKey): Promise<Omit<TonightItem, 'availableOn'>[]> {
    const tmdb = this.tmdb!;
    const overrides = await withUser(this.db, userId, (tx) => tx.select().from(tasteOverrides));
    // o gênero pedido hoje vale sobre os que você marcou
    const liked = genre ? [genre] : overrides.filter((o) => overrideScore(o) >= 0.25).map((o) => o.genre as GenreKey);
    const hated = overrides.filter((o) => o.mode === 'exclude').map((o) => o.genre as GenreKey);
    const providerIds = subs.flatMap((k) => PROVIDER_TMDB_IDS[k] ?? []);
    const medias: ('movie' | 'tv')[] = kind === 'movie' ? ['movie'] : kind === 'series' ? ['tv'] : ['movie', 'tv'];
    const lists = await Promise.all(
      medias.map((m) =>
        tmdb
          .discoverBrowse(m, {
            sort: 'best',
            // página variada: "novas sugestões" não trazem sempre os mesmos
            page: 1 + Math.floor(Math.random() * 3),
            ...(providerIds.length ? { providerIds } : { availableBR: true }),
            ...(liked.length ? { genreIds: tmdbGenreIds(liked, m), anyGenre: true } : {}),
            ...(hated.length ? { withoutGenreIds: tmdbGenreIds(hated, m) } : {}),
          })
          .catch(() => [] as TmdbHit[]),
      ),
    );
    // filmes e séries intercalados
    const mixed: TmdbHit[] = [];
    for (let i = 0; i < Math.max(...lists.map((l) => l.length), 0); i++) for (const l of lists) if (l[i]) mixed.push(l[i]!);
    const labels = liked.slice(0, 3).map((g) => GENRE_LABEL.get(g)?.toLowerCase() ?? g);
    const reason = labels.length ? `Bem avaliado e de ${joinPt(labels)}, que você gosta.` : 'Entre os mais bem avaliados disponíveis para você.';
    return (await this.search.toResults(userId, mixed, 'browse', 20)).map((it) => ({ ...it, aiReason: reason }));
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
