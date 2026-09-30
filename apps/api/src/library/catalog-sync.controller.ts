import { Controller, Get, HttpCode, Inject, Post, ServiceUnavailableException } from '@nestjs/common';
import type { CatalogSyncStatus } from '@fruiqo/contracts';
import type { Queue } from 'bullmq';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { CATALOG_SYNC_JOB, type CatalogSyncJob, MAINTENANCE_QUEUE_TOKEN } from '../queue/queue.js';
import { CatalogSync } from './catalog-sync.js';

/** D-23: estado e disparo da sincronização do Catálogo (antes de /library/:id). */
@Controller('library')
export class CatalogSyncController {
  constructor(
    private readonly sync: CatalogSync,
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly queue: Queue<CatalogSyncJob>,
  ) {}

  @Get('sync')
  status(@CurrentAuth() auth: AccessClaims): Promise<CatalogSyncStatus> {
    return this.sync.status(auth.userId);
  }

  /** "Sincronizar agora": entra na fila do worker (um pedido por vez por usuário). */
  @Post('sync')
  @HttpCode(202)
  async start(@CurrentAuth() auth: AccessClaims): Promise<CatalogSyncStatus> {
    if (!this.sync.available) throw new ServiceUnavailableException('TMDB indisponível agora');
    const current = await this.sync.status(auth.userId);
    if (current.status === 'queued' || current.status === 'running') return current;
    await this.sync.markQueued(auth.userId);
    await this.queue.add(CATALOG_SYNC_JOB, { userId: auth.userId }, { jobId: `catalog-sync-${auth.userId}` });
    return this.sync.status(auth.userId);
  }
}
