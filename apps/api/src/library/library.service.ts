import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  CreateListRequest,
  DiscoverRequest,
  DiscoverResponse,
  FeedbackRequest,
  FeedbackResponse,
  HomeResponse,
  LibraryQuery,
  LibraryResponse,
  ListDetail,
  ListSummary,
  MoodIntentView,
  Suggestion,
  MoveTitleRequest,
  MoveTitleResponse,
  Title,
  UpdateTitleRequest,
} from '@fruiqo/contracts';
import { MY_AREA_STATUSES } from '@fruiqo/contracts';
import {
  GENRE_KEYS,
  type GenreKey,
  type MoodIntent,
  REASON_TAGS,
  RISK_SUPPORT,
  SUBGENRES,
  SUBGENRE_KEYS,
  type SubgenreKey,
  detectRisk,
  interpretMood,
  interpretTasteStatement,
  matchesRule,
} from '@fruiqo/taxonomy';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import { libraryTextCondition } from './library-text.js';
import { MIN_VOTES_FOR_GENERAL, recomputeAutoRatings } from './auto-rating.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, type Tx, withUser } from '../db/client.js';
import {
  listItems,
  lists,
  tasteFavorites,
  overrideScore,
  tasteOverrides,
  tasteStatements,
  recommendationFeedback,
  recommendationRuns,
  recommendations,
  tasteSignals,
  userSubscriptions,
  type ListRow,
  type RecommendationRow,
} from '../db/schema.js';
import { dedupKey } from '../pipeline/dedup.js';
import {
  GENRE_LABEL,
  NEED_LABEL,
  type RankItem,
  type RankRequest,
  type SignalRow,
  availabilityPhrase,
  availableOn,
  pickContinue,
  rankTitles,
  tasteFromSignals,
} from './ranking.js';
import { PROVIDER_LABEL } from './providers.js';
import { type InterpretResult, llmSafeInput, MOOD_INTERPRETER, type MoodInterpreter, RulesInterpreter } from './mood-interpreter.js';
import { readSettings } from './user-settings.js';
import { moveTitle } from './rank-queue.js';

/** D-23: status com posição na fila (Minha Área, para ver) */
const IN_QUEUE = new Set<string>(['to_watch', 'watching']);
import { toTitle } from './title-mapper.js';
import { declaredAffinity } from './fit.js';

/** RF-38: serviços de assinatura onde o título está (flatrate do TMDB, já mapeado para chave própria). */
export function subscriptionProviderKeys(t: Pick<RecommendationRow, 'resolution'>): string[] {
  return (t.resolution?.providers ?? []).filter((p) => p.type === 'flatrate' && p.key).map((p) => p.key!);
}

const SUGGESTIONS_SHOWN = 5;
const RANKED_KEPT = 30;
const SKIP_WINDOW_DAYS = 14;
const GENRE_SET = new Set<string>(GENRE_KEYS);
const SUBGENRE_SET = new Set<string>(SUBGENRE_KEYS);
const REASON_SET = new Set<string>(REASON_TAGS);

type Signal = (typeof tasteSignals.$inferInsert)['signal'];

@Injectable()
export class LibraryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(MOOD_INTERPRETER) interpreter?: MoodInterpreter,
  ) {
    this.interpreter = interpreter ?? new RulesInterpreter();
  }

  private readonly interpreter: MoodInterpreter;

  // ---------- catálogo ----------

  async list(userId: string, q: LibraryQuery): Promise<LibraryResponse> {
    if (q.genre && !GENRE_SET.has(q.genre)) throw new BadRequestException('Entrada inválida: genre');
    const offset = decodeCursor(q.cursor);
    return withUser(this.db, userId, async (tx) => {
      const where = and(
        // RF-28: `review=pending` lista a fila de revisão em vez do catálogo
        eq(recommendations.decision, q.review === 'pending' ? 'review_queue' : 'cataloged'),
        q.status ? eq(recommendations.status, q.status) : undefined,
        !q.status && q.hideWatched ? ne(recommendations.status, 'watched') : undefined,
        // D-23: Minha Área = Quero assistir, Assistindo, Assistido
        !q.status && q.area ? inArray(recommendations.status, [...MY_AREA_STATUSES]) : undefined,
        q.shareId ? eq(recommendations.shareId, q.shareId) : undefined,
        q.kind ? eq(recommendations.kind, q.kind) : undefined,
        q.genre ? sql`${q.genre} = ANY(${recommendations.genres})` : undefined,
        // D-23: nome ou categoria ("sci-fi", "minissérie", "da Netflix")
        q.q ? libraryTextCondition(q.q) : undefined,
        q.listId
          ? inArray(
              recommendations.id,
              tx.select({ id: listItems.recommendationId }).from(listItems).where(eq(listItems.listId, q.listId)),
            )
          : undefined,
      );
      // notas automáticas que faltam (títulos novos): preenche antes de ordenar
      await this.fillMissingAutoRatings(tx);
      const order = libraryOrder(q.sort);
      const rows = await tx
        .select()
        .from(recommendations)
        .where(where)
        .orderBy(...order)
        .limit(q.limit + 1)
        .offset(offset);
      const page = rows.slice(0, q.limit);
      return {
        items: await this.withLists(tx, page),
        nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null,
      };
    });
  }

  private async fillMissingAutoRatings(tx: Tx): Promise<void> {
    const missing = await tx
      .select({ id: recommendations.id })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.decision, 'cataloged'),
          isNull(recommendations.autoRating),
          // só quem tem base (gêneros ou nota geral): sem base continua nulo e não é recalculado sempre
          sql`(cardinality(${recommendations.genres}) > 0 OR ${recommendations.resolution}->>'voteAverage' IS NOT NULL)`,
        ),
      );
    if (missing.length > 0) await recomputeAutoRatings(tx, missing.map((m) => m.id));
  }

  async get(userId: string, id: string): Promise<Title> {
    return withUser(this.db, userId, async (tx) => {
      const row = await this.findTitle(tx, id);
      return (await this.withLists(tx, [row]))[0]!;
    });
  }

  /** Reordena a fila de prioridade (rank-queue.ts). */
  async move(userId: string, id: string, req: MoveTitleRequest): Promise<MoveTitleResponse> {
    return withUser(this.db, userId, async (tx) => {
      const out = await moveTitle(tx, userId, id, req);
      if (out === 'not_found') throw new NotFoundException('Título não encontrado');
      if (out === 'not_in_queue') throw new ConflictException('Título na fila de revisão não tem posição; aprove-o primeiro');
      return { id, ...out };
    });
  }

  async update(userId: string, id: string, patch: UpdateTitleRequest): Promise<Title> {
    if (patch.genres?.some((g) => !GENRE_SET.has(g))) throw new BadRequestException('Entrada inválida: genres');
    return withUser(this.db, userId, async (tx) => {
      const row = await this.findTitle(tx, id);
      const now = new Date();
      // D-23: "Próximo a assistir" leva à fila (Quero assistir, salvo se já está nela) e depois ao topo
      const status = patch.next && !IN_QUEUE.has(patch.status ?? row.status) ? ('to_watch' as const) : patch.status;
      const next = {
        kind: patch.kind ?? row.kind,
        title: patch.title ?? row.title,
        creator: patch.creator === undefined ? row.creator : patch.creator,
      };
      const key = dedupKey(next);
      if (key !== row.dedupKey) {
        const [clash] = await tx
          .select({ id: recommendations.id })
          .from(recommendations)
          .where(eq(recommendations.dedupKey, key));
        if (clash && clash.id !== id) {
          throw new ConflictException({ message: 'Já existe um título igual na sua lista', conflictWith: clash.id });
        }
      }
      const [updated] = await tx
        .update(recommendations)
        .set({
          kind: next.kind,
          title: next.title,
          creator: next.creator,
          dedupKey: key,
          ...(patch.year !== undefined ? { year: patch.year } : {}),
          ...(status ? { status } : {}),
          ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
          ...(patch.watchOn !== undefined ? { watchOn: patch.watchOn } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.genres ? { genres: [...new Set(patch.genres)], enrichment: 'manual' as const } : {}),
          updatedAt: now,
        })
        .where(eq(recommendations.id, id))
        .returning();
      // sinais do perfil de gosto (RF-34): só quando o estado muda de fato
      const signals: { signal: Signal; value: number }[] = [];
      if (status === 'watched' && row.status !== 'watched') signals.push({ signal: 'watched', value: 1 });
      if (status === 'dropped' && row.status !== 'dropped') signals.push({ signal: 'dropped', value: 1 });
      // D-23: escolher "Quero assistir" é uma escolha de gosto (como adicionar a uma lista)
      if (status === 'to_watch' && (row.status === 'catalog' || row.status === 'dropped')) signals.push({ signal: 'added_to_list', value: 1 });
      if (patch.rating !== undefined && patch.rating !== row.rating) {
        // vale só a nota mais recente: a anterior deixa de pesar no gosto (o perfil é refeito dos sinais)
        await tx.delete(tasteSignals).where(and(eq(tasteSignals.recommendationId, id), eq(tasteSignals.signal, 'rated')));
        if (patch.rating != null) signals.push({ signal: 'rated', value: patch.rating });
      }
      if (signals.length > 0) {
        await tx.insert(tasteSignals).values(signals.map((s) => ({ userId, recommendationId: id, ...s })));
      }
      // o gosto mudou (nota, status ou gêneros): as notas automáticas acompanham
      if (signals.length > 0 || patch.rating !== undefined || patch.genres) await recomputeAutoRatings(tx);
      if (patch.next) await moveTitle(tx, userId, id, { to: 'top' });
      await this.touchListsOf(tx, [id], now);
      // relê: o recálculo pode ter mudado a nota automática deste título
      return (await this.withLists(tx, [(await this.findTitle(tx, updated!.id))]))[0]!;
    });
  }

  // ---------- listas ----------

  async lists(userId: string): Promise<ListSummary[]> {
    return withUser(this.db, userId, async (tx) => {
      const rows = await tx.select().from(lists).orderBy(desc(lists.pinned), desc(lists.updatedAt), asc(lists.id));
      return this.summaries(tx, rows);
    });
  }

  async createList(userId: string, input: CreateListRequest): Promise<ListDetail> {
    return withUser(this.db, userId, async (tx) => {
      const ids = [...new Set(input.titleIds ?? [])];
      await this.assertTitles(tx, ids);
      const [list] = await tx.insert(lists).values({ userId, name: input.name }).returning();
      if (ids.length > 0) {
        await tx.insert(listItems).values(ids.map((recommendationId, position) => ({ listId: list!.id, recommendationId, userId, position })));
        await tx.insert(tasteSignals).values(ids.map((recommendationId) => ({ userId, recommendationId, signal: 'added_to_list' as const })));
      }
      return this.detail(tx, list!.id);
    });
  }

  async getList(userId: string, id: string): Promise<ListDetail> {
    return withUser(this.db, userId, (tx) => this.detail(tx, id));
  }

  /** Substitui a ordem completa (e o conteúdo) da lista. Itens novos geram sinal `added_to_list`. */
  async reorder(userId: string, id: string, titleIds: string[]): Promise<ListDetail> {
    const ids = [...new Set(titleIds)];
    return withUser(this.db, userId, async (tx) => {
      await this.findList(tx, id);
      await this.assertTitles(tx, ids);
      const before = await tx.select({ id: listItems.recommendationId }).from(listItems).where(eq(listItems.listId, id));
      const had = new Set(before.map((r) => r.id));
      await tx.delete(listItems).where(eq(listItems.listId, id));
      if (ids.length > 0) {
        await tx.insert(listItems).values(ids.map((recommendationId, position) => ({ listId: id, recommendationId, userId, position })));
      }
      const added = ids.filter((i) => !had.has(i));
      if (added.length > 0) {
        await tx.insert(tasteSignals).values(added.map((recommendationId) => ({ userId, recommendationId, signal: 'added_to_list' as const })));
      }
      await tx.update(lists).set({ updatedAt: new Date() }).where(eq(lists.id, id));
      return this.detail(tx, id);
    });
  }

  async deleteList(userId: string, id: string): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      await this.findList(tx, id);
      await tx.delete(lists).where(eq(lists.id, id));
    });
  }

  // ---------- home (RF-31/32) ----------

  async home(userId: string): Promise<HomeResponse> {
    return withUser(this.db, userId, async (tx) => {
      const titles = await tx.select().from(recommendations).where(eq(recommendations.decision, 'cataloged'));
      const byId = new Map(titles.map((t) => [t.id, t]));
      const listRows = await tx.select().from(lists);
      const subs = new Set((await tx.select().from(userSubscriptions)).map((r) => r.provider));
      const items = listRows.length
        ? await tx.select().from(listItems).where(inArray(listItems.listId, listRows.map((l) => l.id)))
        : [];

      const pick = pickContinue(
        listRows.map((l) => {
          const mine = items.filter((i) => i.listId === l.id && byId.has(i.recommendationId));
          const lastItem = Math.max(0, ...mine.map((i) => byId.get(i.recommendationId)!.updatedAt.getTime()));
          return {
            id: l.id,
            pinned: l.pinned,
            lastActivity: new Date(Math.max(l.updatedAt.getTime(), lastItem)),
            items: mine.map((i) => ({
              id: i.recommendationId,
              status: byId.get(i.recommendationId)!.status,
              position: i.position,
              available: availableOn(subscriptionProviderKeys(byId.get(i.recommendationId)!), subs).length > 0,
            })),
          };
        }),
      );
      let cont: HomeResponse['continue'] = null;
      if (pick) {
        const [summary] = await this.summaries(tx, listRows.filter((l) => l.id === pick.listId));
        const [next] = await this.withLists(tx, [byId.get(pick.nextId)!]);
        const availability = availabilityPhrase(availableOn(subscriptionProviderKeys(byId.get(pick.nextId)!), subs), PROVIDER_LABEL);
        cont = {
          list: summary!,
          next: next!,
          progress: { done: pick.done, total: pick.total },
          ...(availability ? { availability: availability.charAt(0).toUpperCase() + availability.slice(1) } : {}),
        };
      }

      const open = titles.filter((t) => t.status === 'to_watch' || t.status === 'watching');
      const presets = SUBGENRES.map((s) => ({
        key: s.key,
        label: s.label,
        kind: 'subgenre' as const,
        available: open.filter((t) => matchesRule(s.rule, new Set(t.genres as GenreKey[]))).length,
      })).sort((a, b) => b.available - a.available || a.label.localeCompare(b.label, 'pt-BR'));

      return {
        continue: cont,
        presets,
        stats: {
          toWatch: titles.filter((t) => t.status === 'to_watch').length,
          watching: titles.filter((t) => t.status === 'watching').length,
          watched: titles.filter((t) => t.status === 'watched').length,
          total: titles.length,
          withoutGenre: titles.filter((t) => t.genres.length === 0).length,
        },
        aiMode: this.env.AI_MODE,
      };
    });
  }

  // ---------- recomendação (RF-32/33/36/39) ----------

  /**
   * "Como estou": o texto é usado só em memória (risco + interpretação) e descartado; o banco
   * recebe a intenção estruturada (RNF-06). Risco (RNF-07) responde com o acolhimento e nenhuma
   * sugestão até o usuário escolher continuar.
   */
  async discover(userId: string, req: DiscoverRequest): Promise<DiscoverResponse> {
    let rankReq: RankRequest;
    let intent: MoodIntent | null = null;
    let surprise: DiscoverResponse['surprise'] = null;
    let riskShown = false;
    let interpreted: InterpretResult | null = null;
    // D-08: preferências do usuário (lembrar humor = SEC-CTRL-50; IA externa = SEC-CTRL-51)
    const settings = req.mode === 'mood' ? await withUser(this.db, userId, (tx) => readSettings(tx)) : null;

    if (req.mode === 'surprise') {
      if (req.subgenre && !SUBGENRE_SET.has(req.subgenre)) throw new BadRequestException('Entrada inválida: subgenre');
      if (req.genre && !GENRE_SET.has(req.genre)) throw new BadRequestException('Entrada inválida: genre');
      if (req.subgenre) {
        const def = SUBGENRES.find((s) => s.key === req.subgenre)!;
        surprise = { key: def.key, label: def.label, kind: 'subgenre' };
        rankReq = { mode: 'surprise', subgenre: def.key };
      } else {
        surprise = { key: req.genre!, label: GENRE_LABEL.get(req.genre!)!, kind: 'genre' };
        rankReq = { mode: 'surprise', genre: req.genre as GenreKey };
      }
    } else {
      if (this.env.AI_MODE === 'off') throw new BadRequestException('O modo "Como estou" está desligado');
      // RNF-07: o detector roda ANTES de qualquer LLM. Com risco, o texto nunca sai do servidor:
      // mesmo quando o usuário escolhe continuar, a interpretação é local (regras).
      const riskDetected = detectRisk(req.text).risk;
      riskShown = !req.continueAfterRisk && riskDetected;
      if (riskShown) {
        intent = interpretMood(req.text);
      } else {
        // IA externa só com AI_MODE=anthropic (o próprio interpretador injetado) E consentimento individual
        const interpreter = riskDetected || !settings?.aiConsent ? new RulesInterpreter() : this.interpreter;
        interpreted = await interpreter.interpret(llmSafeInput(req.text), userId);
        intent = interpreted.intent;
      }
      rankReq = { mode: 'mood', intent };
    }

    return withUser(this.db, userId, async (tx) => {
      const ranked = riskShown ? [] : await this.rank(tx, rankReq, req.kinds);
      // SEC-CTRL-50: a intenção do "Como estou" só é guardada com "lembrar meu humor"; sem ele, o run
      // fica só com o ranking (para "outra coisa") e é purgado em 1 dia.
      const storedIntent: Record<string, unknown> | null =
        req.mode === 'mood'
          ? intent && settings?.rememberMood
            ? { ...intent }
            : null
          : surprise
            ? { [surprise.kind]: surprise.key }
            : null;
      const [run] = await tx
        .insert(recommendationRuns)
        .values({
          userId,
          mode: req.mode,
          aiMode: this.env.AI_MODE,
          // risco: não guarda nem a intenção (só o evento)
          intent: riskShown ? null : storedIntent,
          riskShown,
          candidateCount: ranked.length,
          interpreter: interpreted?.interpreter ?? null,
          inputTokens: interpreted?.usage?.inputTokens ?? 0,
          outputTokens: interpreted?.usage?.outputTokens ?? 0,
          costUsd: interpreted?.costUsd ?? 0,
          ranked: ranked.slice(0, RANKED_KEPT),
        })
        .returning({ id: recommendationRuns.id });

      const suggestions = await this.suggestions(tx, ranked.slice(0, SUGGESTIONS_SHOWN));
      return {
        runId: run!.id,
        mode: req.mode,
        aiMode: this.env.AI_MODE,
        intent: riskShown || !intent ? null : toIntentView(intent),
        surprise,
        risk: riskShown ? { ...RISK_SUPPORT } : null,
        suggestions,
        ...(interpreted ? { interpreter: interpreted.interpreter } : {}),
        ...(riskShown
          ? {}
          : { message: intent?.message ?? (surprise ? `${surprise.label} da sua lista` : undefined) }),
      };
    });
  }

  /** accept/skip alimentam o perfil (RF-34/37); "another" devolve a próxima sugestão do mesmo ranking. */
  async feedback(userId: string, req: FeedbackRequest): Promise<FeedbackResponse> {
    if (req.reasonTag && !REASON_SET.has(req.reasonTag)) throw new BadRequestException('Entrada inválida: reasonTag');
    return withUser(this.db, userId, async (tx) => {
      const [run] = await tx.select().from(recommendationRuns).where(eq(recommendationRuns.id, req.runId));
      if (!run) throw new NotFoundException('Recomendação não encontrada');
      await this.findTitle(tx, req.titleId);
      await tx.insert(recommendationFeedback).values({
        userId,
        runId: run.id,
        recommendationId: req.titleId,
        action: req.action,
        reasonTag: req.reasonTag ?? null,
        reasonText: req.reasonText ?? null,
      });
      if (req.action !== 'another') {
        await tx.insert(tasteSignals).values({
          userId,
          recommendationId: req.titleId,
          signal: req.action === 'accept' ? 'accepted' : 'skipped',
        });
      }
      if (req.action === 'accept') return { next: null };

      // próxima do ranking que ainda não recebeu feedback nesta execução
      const answered = await tx
        .select({ id: recommendationFeedback.recommendationId })
        .from(recommendationFeedback)
        .where(eq(recommendationFeedback.runId, run.id));
      const seen = new Set(answered.map((a) => a.id));
      const shown = new Set(run.ranked.slice(0, SUGGESTIONS_SHOWN).map((r) => r.id));
      const nextRanked = run.ranked.find((r) => !seen.has(r.id) && !shown.has(r.id)) ?? run.ranked.find((r) => !seen.has(r.id));
      if (!nextRanked) return { next: null };
      const [next] = await this.suggestions(tx, [nextRanked]);
      return { next: next ?? null };
    });
  }

  // ---------- internos ----------

  private async rank(tx: Tx, req: RankRequest, kinds: DiscoverRequest['kinds']) {
    const titles = await tx.select().from(recommendations).where(eq(recommendations.decision, 'cataloged'));
    const since = new Date(Date.now() - SKIP_WINDOW_DAYS * 86_400_000);
    const skipped = await tx
      .select({ id: tasteSignals.recommendationId })
      .from(tasteSignals)
      .where(and(eq(tasteSignals.signal, 'skipped'), gte(tasteSignals.createdAt, since)));
    const taste = await this.taste(tx, titles);
    // RF-29/RNF-10: overrides do perfil valem sobre os sinais; gênero excluído nunca é sugerido
    const overrides = await tx.select().from(tasteOverrides);
    const excluded = new Set(overrides.filter((o) => o.mode === 'exclude').map((o) => o.genre));
    // RF-43: o perfil declarado soma metade do seu peso aos sinais (overrides continuam valendo por cima)
    const [statement] = await tx.select().from(tasteStatements);
    const declared = declaredAffinity(await tx.select().from(tasteFavorites), statement?.summary ? interpretTasteStatement(statement.summary) : null);
    for (const [g, d] of declared) taste[g] = Math.max(-1, Math.min(1, (taste[g] ?? 0) + 0.5 * d.score));
    for (const o of overrides) {
      if (!GENRE_SET.has(o.genre)) continue;
      taste[o.genre as GenreKey] = overrideScore(o);
    }
    const items: RankItem[] = titles
      .filter((t) => !t.genres.some((g) => excluded.has(g)))
      .map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      rank: t.rank ?? Number.MAX_SAFE_INTEGER,
      genres: t.genres.filter((g): g is GenreKey => GENRE_SET.has(g)),
      attributes: t.attributes,
      runtimeMin: t.runtimeMin,
      createdAt: t.createdAt,
      providerKeys: subscriptionProviderKeys(t),
    }));
    const subscriptions = new Set((await tx.select().from(userSubscriptions)).map((r) => r.provider));
    return rankTitles(items, req, {
      subscriptions,
      providerLabel: PROVIDER_LABEL,
      taste,
      recentlySkipped: new Set(skipped.map((s) => s.id).filter((id): id is string => Boolean(id))),
      ...(kinds && kinds.length > 0 ? { kinds } : {}),
    });
  }

  private async taste(tx: Tx, titles: RecommendationRow[]) {
    const rows = await tx.select().from(tasteSignals);
    const genresOf = new Map(titles.map((t) => [t.id, t.genres.filter((g): g is GenreKey => GENRE_SET.has(g))]));
    const signals: SignalRow[] = rows
      .filter((r) => r.recommendationId && genresOf.has(r.recommendationId))
      .map((r) => ({ signal: r.signal, value: r.value, genres: genresOf.get(r.recommendationId!)! }));
    return tasteFromSignals(signals);
  }

  private async suggestions(tx: Tx, ranked: { id: string; score: number; reason: string }[]): Promise<Suggestion[]> {
    if (ranked.length === 0) return [];
    const rows = await tx.select().from(recommendations).where(inArray(recommendations.id, ranked.map((r) => r.id)));
    const titles = new Map((await this.withLists(tx, rows)).map((t) => [t.id, t]));
    return ranked
      .filter((r) => titles.has(r.id))
      .map((r) => ({ title: titles.get(r.id)!, score: r.score, reason: r.reason, source: 'library' as const }));
  }

  private async findTitle(tx: Tx, id: string): Promise<RecommendationRow> {
    const [row] = await tx.select().from(recommendations).where(eq(recommendations.id, id));
    if (!row) throw new NotFoundException('Título não encontrado');
    return row;
  }

  private async findList(tx: Tx, id: string): Promise<ListRow> {
    const [row] = await tx.select().from(lists).where(eq(lists.id, id));
    if (!row) throw new NotFoundException('Lista não encontrada');
    return row;
  }

  /** Todos os ids precisam ser títulos catalogados do usuário (RLS garante o "do usuário"). */
  private async assertTitles(tx: Tx, ids: string[]) {
    if (ids.length === 0) return;
    const rows = await tx
      .select({ id: recommendations.id })
      .from(recommendations)
      .where(and(inArray(recommendations.id, ids), eq(recommendations.decision, 'cataloged')));
    if (rows.length !== ids.length) throw new BadRequestException('Entrada inválida: titleIds');
  }

  async touchListsOf(tx: Tx, titleIds: string[], now: Date) {
    const rows = await tx.select({ listId: listItems.listId }).from(listItems).where(inArray(listItems.recommendationId, titleIds));
    const ids = [...new Set(rows.map((r) => r.listId))];
    if (ids.length > 0) await tx.update(lists).set({ updatedAt: now }).where(inArray(lists.id, ids));
  }

  async withLists(tx: Tx, rows: RecommendationRow[]): Promise<Title[]> {
    if (rows.length === 0) return [];
    const refs = await tx
      .select({ titleId: listItems.recommendationId, id: lists.id, name: lists.name })
      .from(listItems)
      .innerJoin(lists, eq(lists.id, listItems.listId))
      .where(inArray(listItems.recommendationId, rows.map((r) => r.id)))
      .orderBy(asc(lists.name));
    return rows.map((r) => toTitle(r, refs.filter((ref) => ref.titleId === r.id).map(({ id, name }) => ({ id, name }))));
  }

  private async summaries(tx: Tx, rows: ListRow[]): Promise<ListSummary[]> {
    if (rows.length === 0) return [];
    const counts = await tx
      .select({
        listId: listItems.listId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${recommendations.status} in ('watched', 'dropped'))::int`,
      })
      .from(listItems)
      .innerJoin(recommendations, eq(recommendations.id, listItems.recommendationId))
      .where(inArray(listItems.listId, rows.map((r) => r.id)))
      .groupBy(listItems.listId);
    const byList = new Map(counts.map((c) => [c.listId, c]));
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      sourceShareId: l.sourceShareId,
      pinned: l.pinned,
      itemCount: byList.get(l.id)?.total ?? 0,
      doneCount: byList.get(l.id)?.done ?? 0,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    }));
  }

  async detail(tx: Tx, id: string): Promise<ListDetail> {
    const list = await this.findList(tx, id);
    const [summary] = await this.summaries(tx, [list]);
    const rows = await tx
      .select({ rec: recommendations })
      .from(listItems)
      .innerJoin(recommendations, eq(recommendations.id, listItems.recommendationId))
      .where(eq(listItems.listId, id))
      .orderBy(asc(listItems.position));
    return { ...summary!, items: await this.withLists(tx, rows.map((r) => r.rec)) };
  }
}

function toIntentView(intent: MoodIntent): MoodIntentView {
  return {
    need: intent.need,
    needLabel: NEED_LABEL[intent.need],
    avoid: intent.avoid,
    tone: intent.tone,
    energy: intent.energy,
    kinds: intent.kinds,
    ...(intent.maxRuntimeMin ? { maxRuntimeMin: intent.maxRuntimeMin } : {}),
    ...(intent.message ? { message: intent.message } : {}),
  };
}


function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!m) throw new BadRequestException('Entrada inválida: cursor');
  return Number(m[1]);
}

export type { SubgenreKey };

// nota geral só com votos suficientes (MIN_VOTES_FOR_GENERAL): um voto 10 não vai para o topo
const GENERAL = sql`(CASE WHEN coalesce((${recommendations.resolution}->>'voteCount')::int, 0) >= ${sql.raw(String(MIN_VOTES_FOR_GENERAL))} THEN (${recommendations.resolution}->>'voteAverage')::real END)`;

/**
 * D-23: ordem padrão (`score`) = fila manual → minhas estrelas → nota automática → nota geral. As
 * demais começam pela nota escolhida e desempatam pela mesma sequência.
 */
export function libraryOrder(sort: LibraryQuery['sort']) {
  const byRank = sql`${recommendations.rank} asc nulls last`;
  const byMine = sql`${recommendations.rating} desc nulls last`;
  const byAuto = sql`${recommendations.autoRating} desc nulls last`;
  const byGeneral = sql`${GENERAL} desc nulls last`;
  const tail = [desc(recommendations.createdAt), asc(recommendations.id)];
  switch (sort) {
    case 'recent':
      return [desc(recommendations.createdAt), desc(recommendations.id)];
    case 'title':
      return [asc(recommendations.title), asc(recommendations.id)];
    case 'mine':
      return [byMine, byAuto, byGeneral, ...tail];
    case 'auto':
      return [byAuto, byGeneral, ...tail];
    case 'general':
      return [byGeneral, byAuto, ...tail];
    case 'rank':
    case 'score':
    default:
      return [byRank, byMine, byAuto, byGeneral, ...tail];
  }
}
