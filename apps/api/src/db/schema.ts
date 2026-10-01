import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  primaryKey,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Resolution } from '@fruiqo/contracts';

// Todas as tabelas com dados do usuário têm RLS FORCE (ver drizzle/0001_rls.sql).

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceName: text('device_name').notNull(),
    refreshHash: text('refresh_hash').notNull(),
    /** hash do refresh anterior: se reaparecer, é reuso e a sessão é revogada */
    prevRefreshHash: text('prev_refresh_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientShareId: uuid('client_share_id').notNull(),
    status: text('status', {
      enum: ['queued', 'processing', 'done', 'failed', 'rejected'],
    }).notNull(),
    /** conteúdo bruto; apagado quando o processamento termina (minimização) */
    inputText: text('input_text'),
    inputUrl: text('input_url'),
    /** texto de cada print (OCR feito no device); apagado junto com input_text */
    inputPages: jsonb('input_pages').$type<string[]>(),
    origin: text('origin', { enum: ['link', 'text', 'screenshot', 'text_file'] }).notNull().default('link'),
    /**
     * RF-42: lista proposta pelo import (nome + dedup_keys na ordem extraída, inclusive os que o usuário
     * já tinha). A lista só é criada na primeira aprovação de um item deste share.
     */
    proposedList: jsonb('proposed_list').$type<ProposedListRow>(),
    pageCount: integer('page_count'),
    /** prints idênticos a prints já enviados em outro share do usuário */
    pagesIgnored: integer('pages_ignored').notNull().default(0),
    /** recomendações que já existiam em outro share do usuário (não repetidas) */
    itemsAlreadyInList: integer('items_already_in_list').notNull().default(0),
    platform: text('platform', { enum: ['youtube', 'instagram', 'tiktok', 'other'] })
      .notNull()
      .default('other'),
    sourceUrl: text('source_url'),
    sourceTitle: text('source_title'),
    sourceAuthor: text('source_author'),
    sourceThumbnailUrl: text('source_thumbnail_url'),
    /** quando os metadados de oEmbed foram obtidos (TTL do YouTube: 30 dias) */
    sourceFetchedAt: timestamp('source_fetched_at', { withTimezone: true }),
    error: text('error'),
    /** share criado pelo sandbox/eval (RF-18/19): os resumos das etapas guardam trechos de texto */
    isFixture: boolean('is_fixture').notNull().default(false),
    fixtureId: text('fixture_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shares_user_client_key').on(t.userId, t.clientShareId),
    index('shares_user_created_idx').on(t.userId, t.createdAt, t.id),
  ],
);

export const recommendations = pgTable(
  'recommendations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** null em título do seed de demonstração ou adicionado à mão (não veio de um share) */
    shareId: uuid('share_id').references(() => shares.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['movie', 'series', 'music_track', 'music_album', 'artist', 'book', 'other'],
    }).notNull(),
    title: text('title').notNull(),
    creator: text('creator'),
    year: integer('year'),
    confidence: real('confidence').notNull(),
    extractor: text('extractor', { enum: ['llm', 'heuristic'] }).notNull(),
    resolution: jsonb('resolution').$type<Resolution>(),
    /** quando a resolução foi obtida (TTL TMDB: 180 dias) */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** chave de deduplicação por usuário (ver src/pipeline/dedup.ts) */
    dedupKey: text('dedup_key').notNull(),
    /** RF-19/RF-28: só 'cataloged' é catálogo; 'review_queue' espera revisão. Descartados não viram linha aqui. */
    decision: text('decision', { enum: ['cataloged', 'review_queue'] }).notNull().default('cataloged'),
    decisionReason: text('decision_reason'),
    /** RF-42: o que o pipeline sugeriria; todo import entra como review_queue */
    suggestedDecision: text('suggested_decision', { enum: ['cataloged', 'review_queue'] }),
    /** RF-47: aderência do match (título/ano/tipo) ao texto importado, 0..1 */
    matchScore: real('match_score'),
    /** RF-47: até 3 outras opções de match do TMDB (dados do TMDB: TTL de 180 dias pela purga) */
    matchAlternatives: jsonb('match_alternatives').$type<StoredAlternativeRow[]>(),
    /** ordem do item no conteúdo importado (posição na lista proposta) */
    sourcePosition: integer('source_position'),
    // ---- catálogo (a recomendação catalogada é o "título" do usuário; ver README) ----
    /**
     * D-23: `catalog` = está no catálogo do usuário sem intenção de ver agora; Minha Área =
     * `to_watch` (Quero assistir), `watching` (com `watchOn`) e `watched`.
     */
    status: text('status', { enum: ['catalog', 'to_watch', 'watching', 'watched', 'dropped'] }).notNull().default('to_watch'),
    /** onde está assistindo (chave de STREAMING_PROVIDERS ou texto livre do usuário) */
    watchOn: text('watch_on'),
    /** nota automática 0.5..5, calculada localmente do gosto do usuário (sem LLM, ARB-REQ-06) */
    autoRating: real('auto_rating'),
    /**
     * posição na fila de prioridade do usuário (1 = mais prioritário), única e contínua entre os
     * catalogados; null na fila de revisão. Mantida por triggers + unicidade DEFERRABLE (0008_title_rank.sql).
     */
    rank: integer('rank'),
    rating: real('rating'),
    notes: text('notes'),
    /** chaves de gênero da taxonomia (@fruiqo/taxonomy) */
    genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
    /** atributos derivados explícitos (heavy, sad_ending…) quando conhecidos */
    attributes: text('attributes').array().notNull().default(sql`'{}'::text[]`),
    runtimeMin: integer('runtime_min'),
    enrichment: text('enrichment', { enum: ['none', 'tmdb', 'openlibrary', 'demo', 'manual'] }).notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recommendations_share_idx').on(t.shareId),
    index('recommendations_user_status_idx').on(t.userId, t.status),
    uniqueIndex('recommendations_user_dedup_key').on(t.userId, t.dedupKey),
    // (user_id, rank): índice da constraint UNIQUE DEFERRABLE criada em SQL (0008_title_rank.sql)
  ],
);

/**
 * Hashes (sha256 do texto normalizado) dos prints já recebidos por usuário. Só o hash é retido.
 * Some junto com o share que registrou o print: apagar o share libera o reenvio do mesmo print.
 */
export const seenPages = pgTable(
  'seen_pages',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageHash: text('page_hash').notNull(),
    firstShareId: uuid('first_share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageHash] })],
);

/**
 * RF-19: uma linha por etapa do pipeline de um share. Resumos pequenos; trechos de texto de
 * terceiros (`preview`) só ficam em shares de fixture (ver src/pipeline/steps.ts).
 */
export const pipelineStepLogs = pgTable(
  'pipeline_step_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareId: uuid('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    step: text('step').notNull(),
    mode: text('mode', { enum: ['mock', 'live', 'record'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    inputSummary: jsonb('input_summary').$type<Record<string, unknown>>().notNull(),
    outputSummary: jsonb('output_summary').$type<Record<string, unknown>>().notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costEstimateUsd: real('cost_estimate_usd').notNull().default(0),
    error: text('error'),
  },
  (t) => [uniqueIndex('pipeline_step_logs_share_seq').on(t.shareId, t.seq)],
);

/** RF-19/RF-28: decisão por candidato extraído (inclui os descartados, que não viram recomendação). */
export const candidateDecisions = pgTable(
  'candidate_decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareId: uuid('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => recommendations.id, { onDelete: 'set null' }),
    rawTitle: text('raw_title').notNull(),
    kind: text('kind', {
      enum: ['movie', 'series', 'music_track', 'music_album', 'artist', 'book', 'other'],
    }).notNull(),
    confidenceScore: real('confidence_score').notNull(),
    decision: text('decision', { enum: ['cataloged', 'review_queue', 'discarded'] }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('candidate_decisions_share_idx').on(t.shareId)],
);

/** Listas do usuário (RF-26/31). `source_share_id`: gerada automaticamente a partir de um share de prints. */
export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sourceShareId: uuid('source_share_id').references(() => shares.id, { onDelete: 'set null' }),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lists_user_idx').on(t.userId)],
);

export const listItems = pgTable(
  'list_items',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id')
      .notNull()
      .references(() => recommendations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.recommendationId] }), index('list_items_rec_idx').on(t.recommendationId)],
);

/** RF-34: sinais que formam o perfil de gosto (incremental; o perfil é calculado a partir deles). */
export const tasteSignals = pgTable(
  'taste_signals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => recommendations.id, { onDelete: 'cascade' }),
    signal: text('signal', {
      enum: ['watched', 'rated', 'dropped', 'added_to_list', 'accepted', 'skipped'],
    }).notNull(),
    /** nota (0,5–5, de meia em meia) para `rated`; 1 para os demais */
    value: real('value').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('taste_signals_user_idx').on(t.userId, t.createdAt)],
);

/**
 * RF-39: cada execução de recomendação. Guarda a intenção ESTRUTURADA e o ranking; o texto livre do
 * "Como estou" nunca é gravado (RNF-06).
 */
export const recommendationRuns = pgTable(
  'recommendation_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['surprise', 'mood'] }).notNull(),
    aiMode: text('ai_mode', { enum: ['off', 'rules', 'anthropic'] }).notNull(),
    /** MoodIntent (mood) ou { subgenre | genre } (surprise) */
    intent: jsonb('intent').$type<Record<string, unknown>>(),
    riskShown: boolean('risk_shown').notNull().default(false),
    candidateCount: integer('candidate_count').notNull().default(0),
    /** 2d (RNF-09): quem interpretou o "Como estou" e o custo estimado; nunca o texto */
    interpreter: text('interpreter', { enum: ['rules', 'anthropic'] }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    /** ranking completo (id, score, motivo) para "outra coisa" sem recalcular */
    ranked: jsonb('ranked').$type<{ id: string; score: number; reason: string }[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recommendation_runs_user_idx').on(t.userId, t.createdAt)],
);

export const recommendationFeedback = pgTable(
  'recommendation_feedback',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => recommendationRuns.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id')
      .notNull()
      .references(() => recommendations.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['accept', 'skip', 'another'] }).notNull(),
    reasonTag: text('reason_tag'),
    reasonText: text('reason_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recommendation_feedback_user_idx').on(t.userId, t.createdAt)],
);

export type ShareRow = typeof shares.$inferSelect;

/** RF-42: lista proposta por um import (prints/.txt): nome e chaves de dedup na ordem extraída */
export interface ProposedListRow {
  name: string;
  keys: string[];
  /** lista criada na primeira aprovação (apagada pelo usuário = não recria) */
  listId?: string;
}

/** RF-48: alternativa de match de livro (Open Library) guardada em `match_alternatives` */
export interface BookAlternativeRow {
  provider: 'openlibrary';
  olWorkId: string;
  title: string;
  authors?: string[];
  year?: number;
  coverUrl?: string;
  score: number;
}
/** Alternativa guardada: TMDB (sem `provider`, formato original) ou livro. */
export type StoredAlternativeRow = MatchAlternativeRow | BookAlternativeRow;
export function isBookAlternative(a: StoredAlternativeRow): a is BookAlternativeRow {
  return (a as BookAlternativeRow).provider === 'openlibrary';
}

export interface MatchAlternativeRow {
  provider?: undefined;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  posterUrl?: string;
  overview?: string;
  score: number;
}
export type RecommendationRow = typeof recommendations.$inferSelect;
export type ListRow = typeof lists.$inferSelect;

/** RF-27/28: trilha das correções e decisões de revisão feitas pelo usuário. */
export const reviewActions = pgTable(
  'review_actions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** null quando o título foi rejeitado/mesclado (a linha deixou de existir) */
    recommendationId: uuid('recommendation_id').references(() => recommendations.id, { onDelete: 'set null' }),
    action: text('action', { enum: ['approve', 'reject', 'rematch', 'correct', 'merge'] }).notNull(),
    before: jsonb('before').$type<Record<string, unknown>>().notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_actions_user_idx').on(t.userId, t.createdAt)],
);

/**
 * RF-29/RNF-10: correções manuais do perfil de gosto. `pin` = adoro (1), `exclude` = detesto (-1,
 * nunca sugerido) e `level` = nível intermediário escolhido pelo usuário, em `score` (-1..1).
 */
export const tasteOverrides = pgTable(
  'taste_overrides',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    genre: text('genre').notNull(),
    mode: text('mode', { enum: ['pin', 'exclude', 'level'] }).notNull(),
    score: real('score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.genre] })],
);

/** Afinidade de um override de gênero (-1..1). */
export function overrideScore(o: { mode: 'pin' | 'exclude' | 'level'; score: number | null }): number {
  return o.mode === 'pin' ? 1 : o.mode === 'exclude' ? -1 : Math.max(-1, Math.min(1, o.score ?? 0));
}

/**
 * Uso de IA por chamada (tokens e custo estimado pelo preço do modelo), para o resumo "Uso de IA"
 * do Perfil. Nunca guarda o texto enviado nem a resposta.
 */
/**
 * D-25: "não mostrar mais" no "O que assistir hoje?" (botão − nas prateleiras e nos resultados).
 * Sai das prateleiras e da busca daquele usuário; não mexe no catálogo.
 */
export const tonightHidden = pgTable(
  'tonight_hidden',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    tmdbId: integer('tmdb_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mediaType, t.tmdbId] })],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    ok: boolean('ok').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_user_created_idx').on(t.userId, t.createdAt)],
);

/** Preferência manual por subgênero (gosto / não gosto); entra no encaixe e na nota automática. */
export const tasteSubgenrePrefs = pgTable(
  'taste_subgenre_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subgenre: text('subgenre').notNull(),
    pref: text('pref', { enum: ['like', 'dislike'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.subgenre] })],
);

/** RF-38 (declaração): serviços que o usuário diz assinar. Nenhuma integração com as plataformas. */
/** D-08: preferências de privacidade (SEC-CTRL-50 lembrar humor; SEC-CTRL-51 consentimento de IA). Sem linha = padrões (tudo false). */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  rememberMood: boolean('remember_mood').notNull().default(false),
  aiConsent: boolean('ai_consent').notNull().default(false),
  aiConsentAt: timestamp('ai_consent_at', { withTimezone: true }),
  /** primeiro acesso: quando o usuário concluiu (ou dispensou) a definição do perfil */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

/** RF-25: estado anterior de uma edição em massa, para desfazer (uso único, validade curta). */
export const bulkUndo = pgTable(
  'bulk_undo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bulk_undo_user_idx').on(t.userId, t.expiresAt)],
);

/** RF-43: filmes/séries que o usuário declara ter adorado (perfil declarado). */
export const tasteFavorites = pgTable(
  'taste_favorites',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['movie', 'series', 'music_track', 'music_album', 'artist', 'book', 'other'] }).notNull(),
    year: integer('year'),
    rating: real('rating'),
    comment: text('comment'),
    /** chaves da taxonomia (derivadas do TMDB quando resolvido) */
    genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
    tmdbId: integer('tmdb_id'),
    mediaType: text('media_type', { enum: ['movie', 'tv'] }),
    posterUrl: text('poster_url'),
    /** RF-48: obra da Open Library (livro escolhido na busca); capa expira em 30 dias (TOS-REQ-62) */
    olWorkId: text('ol_work_id'),
    /** quando os dados do TMDB/Open Library foram obtidos (TTL: 180 dias TMDB, 30 dias Open Library) */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('taste_favorites_user_idx').on(t.userId, t.createdAt)],
);

/** RF-43: resumo livre do gosto (o texto é do próprio usuário e fica guardado por escolha dele). */
export const tasteStatements = pgTable('taste_statements', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** RF-44: rascunho de priorização (1 por usuário). `base` = fila no momento da geração. */
export const priorityDrafts = pgTable('priority_drafts', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  order: jsonb('order').$type<{ id: string; score: number; reason: string }[]>().notNull(),
  base: jsonb('base').$type<{ id: string; rank: number }[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * D-23: sincronização do Catálogo com o TMDB (1 por usuário). Primeiro os mais bem avaliados
 * (página por tipo), depois do mais novo para o mais velho (`older_than_*` = até onde já foi).
 */
export const catalogSyncState = pgTable('catalog_sync_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['idle', 'queued', 'running', 'failed'] }).notNull().default('idle'),
  bestPageMovie: integer('best_page_movie').notNull().default(0),
  bestPageTv: integer('best_page_tv').notNull().default(0),
  olderThanMovie: date('older_than_movie'),
  olderThanTv: date('older_than_tv'),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastFinishedAt: timestamp('last_finished_at', { withTimezone: true }),
  lastAdded: integer('last_added').notNull().default(0),
  totalAdded: integer('total_added').notNull().default(0),
  lastError: text('last_error'),
});
export type CatalogSyncStateRow = typeof catalogSyncState.$inferSelect;
