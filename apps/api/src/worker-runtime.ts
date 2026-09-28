import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { REDACT_PATHS } from './common/logger.js';
import type { Env } from './config/env.js';
import { createDb } from './db/client.js';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicExtractor } from './pipeline/extractors/anthropic.js';
import { type LlmClient, PipelineGateway } from './pipeline/gateway.js';
import { HeuristicExtractor } from './pipeline/extractors/heuristic.js';
import { fetchOEmbed } from './pipeline/oembed.js';
import { type Resolver, ShareProcessor } from './pipeline/process-share.js';
import { consumeDailyQuota } from './pipeline/quota.js';
import { SpotifyResolver } from './pipeline/resolvers/spotify.js';
import { TmdbResolver } from './pipeline/resolvers/tmdb.js';
import {
  MAINTENANCE_QUEUE,
  redisConnection,
  RETENTION_JOB,
  SHARE_QUEUE,
  type ShareJob,
  ShareJobSchema,
} from './queue/queue.js';

const RETENTION_EVERY_MS = 6 * 3600 * 1000;

export interface WorkerRuntime {
  processor: ShareProcessor;
  close(): Promise<void>;
}

export function buildProcessor(
  env: Env,
  logger: Logger,
  db: ReturnType<typeof createDb>['db'],
  redis: Redis,
  gateway: PipelineGateway = new PipelineGateway({ mode: env.PIPELINE_MODE }),
) {
  // RF-20: toda chamada externa passa pelo gateway (mock = sem rede; record = grava em fixtures-private/)
  const fetchImpl = gateway.fetchImpl;
  const resolvers: Resolver[] = [];
  // no mock os resolvers existem sem chave real: as respostas vêm das gravações das fixtures
  const tmdbKey = env.TMDB_API_KEY ?? (gateway.mode === 'mock' ? 'mock-key' : undefined);
  if (tmdbKey) resolvers.push(new TmdbResolver(tmdbKey, fetchImpl));
  const spotify =
    env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET
      ? { id: env.SPOTIFY_CLIENT_ID, secret: env.SPOTIFY_CLIENT_SECRET }
      : gateway.mode === 'mock'
        ? { id: 'mock-id', secret: 'mock-secret' }
        : null;
  if (spotify) resolvers.push(new SpotifyResolver(spotify.id, spotify.secret, fetchImpl));

  // D-04: conteúdo real só vai ao LLM com as duas flags ligadas (PEND-10 resolvida).
  const llmAllowed = env.LLM_ENABLED && env.LLM_REAL_CONTENT_ALLOWED;
  const llm = llmAllowed
    ? new AnthropicExtractor({
        model: env.LLM_MODEL,
        maxInputChars: env.LLM_MAX_INPUT_CHARS,
        consumeQuota: (userId) => consumeDailyQuota(redis, 'llm', userId, env.LLM_DAILY_QUOTA),
        client: gateway.llmClient(
          () => new Anthropic({ maxRetries: 2, timeout: 60_000 }) as unknown as LlmClient,
        ),
      })
    : undefined;

  logger.info(
    {
      mode: gateway.mode,
      llm: llmAllowed ? env.LLM_MODEL : 'off',
      tmdb: Boolean(env.TMDB_API_KEY),
      spotify: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
      instagramOEmbed: Boolean(env.META_OEMBED_ACCESS_TOKEN),
      recordings: gateway.mode === 'mock' ? gateway.recordingCount : undefined,
    },
    'pipeline configurado',
  );

  return new ShareProcessor({
    db,
    logger,
    heuristic: new HeuristicExtractor(),
    ...(llm ? { llm } : {}),
    fetchMetadata: (platform, url) =>
      fetchOEmbed(platform, url, { metaAccessToken: env.META_OEMBED_ACCESS_TOKEN, fetchImpl }),
    resolvers,
    mode: gateway.mode,
    decisionPolicy: { reviewThreshold: env.REVIEW_THRESHOLD, discardThreshold: env.DISCARD_THRESHOLD },
    pricing: { inPerMTok: env.LLM_PRICE_IN_PER_MTOK, outPerMTok: env.LLM_PRICE_OUT_PER_MTOK },
    runWithFixture: (fixtureId, fn) => gateway.runWithFixture(fixtureId, fn),
  });
}

export async function startWorker(env: Env): Promise<WorkerRuntime> {
  const logger = pino({ level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } });
  const { db, pool } = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const processor = buildProcessor(env, logger, db, redis);
  const connection = redisConnection(env.REDIS_URL);

  const shareWorker = new Worker<ShareJob>(
    SHARE_QUEUE,
    async (job) => {
      const parsed = ShareJobSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError('payload de job inválido');
      try {
        await processor.process(parsed.data);
      } catch (err) {
        const attempts = job.opts.attempts ?? 1;
        if (job.attemptsMade + 1 >= attempts) await processor.markFailed(parsed.data);
        throw err;
      }
    },
    { connection, concurrency: 4 },
  );
  shareWorker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, err: err.message }, 'job de share falhou'),
  );

  const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
  await maintenance.upsertJobScheduler(RETENTION_JOB, { every: RETENTION_EVERY_MS }, { name: RETENTION_JOB });
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async () => {
      const res = await db.execute<{ tmdb_cleared: number; youtube_cleared: number }>(
        sql`select * from purge_expired_third_party_data()`,
      );
      logger.info(res.rows[0] ?? {}, 'retenção aplicada');
    },
    { connection },
  );

  logger.info('worker iniciado');
  return {
    processor,
    async close() {
      await shareWorker.close();
      await maintenanceWorker.close();
      await maintenance.close();
      redis.disconnect();
      await pool.end();
    },
  };
}
