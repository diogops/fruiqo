import {
  Controller,
  Get,
  Global,
  Inject,
  type DynamicModule,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import { LoggerModule } from 'nestjs-pino';
import type pg from 'pg';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard, Public } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/tokens.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { pinoParams } from './common/logger.js';
import { ENV, type Env } from './config/env.js';
import { createDb, DB } from './db/client.js';
import { createShareQueue, SHARE_QUEUE_TOKEN, type ShareJob } from './queue/queue.js';
import { HomeController, LibraryController, ListsController } from './library/library.controller.js';
import { TaxonomyController } from './library/taxonomy.controller.js';
import {
  CatalogController,
  ListsAdminController,
  ProfileController,
  ReviewController,
  SandboxController,
} from './library/catalog.controller.js';
import { CatalogService } from './library/catalog.service.js';
import { SandboxService } from './sandbox/sandbox.service.js';
import { createTitleLookup, EnrichmentService, TITLE_LOOKUP } from './library/enrichment.service.js';
import { LibraryService } from './library/library.service.js';
import { createMoodInterpreter, MOOD_INTERPRETER } from './library/mood-interpreter.js';
import { SharesController } from './shares/shares.controller.js';
import { SharesService } from './shares/shares.service.js';

const PG_POOL = Symbol('PG_POOL');

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Global()
@Module({})
class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(SHARE_QUEUE_TOKEN) private readonly queue: Queue<ShareJob>,
  ) {}

  static forEnv(env: Env): DynamicModule {
    const { db, pool } = createDb(env.DATABASE_URL);
    return {
      module: InfraModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: DB, useValue: db },
        { provide: PG_POOL, useValue: pool },
        { provide: SHARE_QUEUE_TOKEN, useFactory: () => createShareQueue(env.REDIS_URL) },
        {
          provide: TokenService,
          useValue: new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS),
        },
      ],
      exports: [ENV, DB, SHARE_QUEUE_TOKEN, TokenService],
    };
  }

  async onApplicationShutdown() {
    await this.queue.close();
    await this.pool.end();
  }
}

@Module({})
export class AppModule {
  static forEnv(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.forEnv(env),
        LoggerModule.forRoot(pinoParams(env)),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [
        HealthController,
        AuthController,
        SharesController,
        // CatalogController antes do LibraryController: rotas estáticas de /library (bulk) vêm primeiro
        CatalogController,
        LibraryController,
        ListsController,
        ListsAdminController,
        HomeController,
        TaxonomyController,
        ReviewController,
        ProfileController,
        SandboxController,
      ],
      providers: [
        AuthService,
        SharesService,
        LibraryService,
        CatalogService,
        EnrichmentService,
        { provide: TITLE_LOOKUP, useFactory: () => createTitleLookup(env) },
        { provide: MOOD_INTERPRETER, useFactory: () => createMoodInterpreter(env) },
        SandboxService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
