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
import { AccountController } from './auth/account.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard, Public } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { AdminController } from './auth/admin.controller.js';
import { GOOGLE_VERIFIER, googleVerifier } from './auth/google.js';
import { TokenService } from './auth/tokens.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { pinoParams } from './common/logger.js';
import { ENV, type Env } from './config/env.js';
import { createDb, DB, type Db } from './db/client.js';
import type { TmdbResolver } from './pipeline/resolvers/tmdb.js';
import { createMaintenanceQueue, createShareQueue, MAINTENANCE_QUEUE_TOKEN, SHARE_QUEUE_TOKEN, type ShareJob } from './queue/queue.js';
import { CatalogSync } from './library/catalog-sync.js';
import { CatalogSyncController } from './library/catalog-sync.controller.js';
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
import { PriorityDraftService } from './library/priority-draft.service.js';
import { ProfileService } from './library/profile.service.js';
import { ReviewService } from './library/review.service.js';
import { SearchService } from './library/search.service.js';
import { DeclaredProfileController, LibraryExtrasController, SearchController, TonightController } from './library/taste-search.controller.js';
import { createTitleGuesser, TITLE_GUESSER } from './library/title-guesser.js';
import { AI_TITLE_FINDER, createAiTitleFinder } from './library/ai-title-finder.js';
import { AiUsageController } from './ai-usage/ai-usage.controller.js';
import { createTasteAi, TASTE_AI } from './library/taste-ai.js';
import { TonightService } from './library/tonight.service.js';
import { createOpenLibraryCatalog, OPENLIBRARY_CATALOG } from './library/openlibrary-catalog.js';
import { createTmdbCatalog, TMDB_CATALOG } from './library/tmdb-catalog.js';
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
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly maintenance: Queue,
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
        { provide: MAINTENANCE_QUEUE_TOKEN, useFactory: () => createMaintenanceQueue(env.REDIS_URL) },
        {
          provide: TokenService,
          useValue: new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS),
        },
      ],
      exports: [ENV, DB, SHARE_QUEUE_TOKEN, MAINTENANCE_QUEUE_TOKEN, TokenService],
    };
  }

  async onApplicationShutdown() {
    await this.queue.close();
    await this.maintenance.close();
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
        // limite global por IP; API_RATE_LIMIT_PER_MIN só para testes/ambientes com muitas chamadas legítimas
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: Number(process.env.API_RATE_LIMIT_PER_MIN ?? 120) }]),
      ],
      controllers: [
        AdminController,
        HealthController,
        AuthController,
        AccountController,
        SharesController,
        // CatalogController antes do LibraryController: rotas estáticas de /library (bulk) vêm primeiro
        CatalogController,
        // /library/priority-draft e /library/import também antes de /library/:id
        LibraryExtrasController,
        // D-23: /library/sync antes de /library/:id
        CatalogSyncController,
        LibraryController,
        ListsController,
        ListsAdminController,
        HomeController,
        TaxonomyController,
        ReviewController,
        ProfileController,
        DeclaredProfileController,
        AiUsageController,
        SearchController,
        TonightController,
        SandboxController,
      ],
      providers: [
        AuthService,
        // login com Google: só com GOOGLE_CLIENT_ID (sem ele, as rotas respondem "desligado")
        { provide: GOOGLE_VERIFIER, useFactory: () => (env.GOOGLE_CLIENT_ID ? googleVerifier(env.GOOGLE_CLIENT_ID) : null) },
        SharesService,
        LibraryService,
        CatalogService,
        EnrichmentService,
        ReviewService,
        ProfileService,
        PriorityDraftService,
        SearchService,
        { provide: TITLE_LOOKUP, useFactory: () => createTitleLookup(env) },
        { provide: TMDB_CATALOG, useFactory: () => createTmdbCatalog(env) },
        { provide: CatalogSync, useFactory: (db: Db, tmdb: TmdbResolver | null) => new CatalogSync(db, tmdb), inject: [DB, TMDB_CATALOG] },
        { provide: OPENLIBRARY_CATALOG, useFactory: () => createOpenLibraryCatalog(env) },
        { provide: TITLE_GUESSER, useFactory: () => createTitleGuesser(env) },
        { provide: AI_TITLE_FINDER, useFactory: () => createAiTitleFinder(env) },
        { provide: TASTE_AI, useFactory: () => createTasteAi(env) },
        TonightService,
        { provide: MOOD_INTERPRETER, useFactory: () => createMoodInterpreter(env) },
        SandboxService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
