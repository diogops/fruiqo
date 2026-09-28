import { Queue } from 'bullmq';
import { z } from 'zod';

export const SHARE_QUEUE = 'share-processing';
export const MAINTENANCE_QUEUE = 'maintenance';
export const RETENTION_JOB = 'retention-purge';

/** Payload do job: o worker revalida (SEC-REQ-18) e nunca confia em nada além destes IDs. */
export const ShareJobSchema = z.object({ shareId: z.uuid(), userId: z.uuid() }).strict();
export type ShareJob = z.infer<typeof ShareJobSchema>;

export const SHARE_QUEUE_TOKEN = Symbol('SHARE_QUEUE');

export function redisConnection(url: string) {
  return { url, maxRetriesPerRequest: null };
}

export function createShareQueue(redisUrl: string): Queue<ShareJob> {
  return new Queue<ShareJob>(SHARE_QUEUE, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}
