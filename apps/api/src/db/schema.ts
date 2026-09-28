import { sql } from 'drizzle-orm';
import {
  boolean,
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
    origin: text('origin', { enum: ['link', 'screenshot'] }).notNull().default('link'),
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
    shareId: uuid('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['movie', 'series', 'music_track', 'music_album', 'artist', 'other'],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recommendations_share_idx').on(t.shareId),
    uniqueIndex('recommendations_user_dedup_key').on(t.userId, t.dedupKey),
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
      enum: ['movie', 'series', 'music_track', 'music_album', 'artist', 'other'],
    }).notNull(),
    confidenceScore: real('confidence_score').notNull(),
    decision: text('decision', { enum: ['cataloged', 'review_queue', 'discarded'] }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('candidate_decisions_share_idx').on(t.shareId)],
);

export type ShareRow = typeof shares.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
