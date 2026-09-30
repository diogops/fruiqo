import { Queue } from 'bullmq';
import { z } from 'zod';

export const SHARE_QUEUE = 'share-processing';
export const MAINTENANCE_QUEUE = 'maintenance';
export const RETENTION_JOB = 'retention-purge';
/** D-23: atualização do catálogo com o TMDB às 12h e às 21h (horário de Brasília) */
export const CATALOG_REFRESH_JOB = 'catalog-refresh';
export const CATALOG_REFRESH_CRON = { pattern: '0 12,21 * * *', tz: 'America/Sao_Paulo' } as const;

/** D-23: sincronização do Catálogo pedida pelo usuário ("Sincronizar agora") */
export const CATALOG_SYNC_JOB = 'catalog-sync';
/** ao iniciar o worker: sincroniza quem nunca foi sincronizado */
export const CATALOG_SYNC_BOOT_JOB = 'catalog-sync-boot';
export const CatalogSyncJobSchema = z.object({ userId: z.uuid() }).strict();
export type CatalogSyncJob = z.infer<typeof CatalogSyncJobSchema>;
export const MAINTENANCE_QUEUE_TOKEN = Symbol('MAINTENANCE_QUEUE');

export function createMaintenanceQueue(redisUrl: string): Queue {
  return new Queue(MAINTENANCE_QUEUE, {
    connection: redisConnection(redisUrl),
    // jobId por usuário: sem guardar o job concluído, um novo pedido pode entrar depois
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
  });
}

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
