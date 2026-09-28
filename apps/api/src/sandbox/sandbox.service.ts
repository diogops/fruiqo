import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateShareRequestSchema,
  type SandboxEvalsResponse,
  type SandboxFixturesResponse,
  type SandboxRunResponse,
  type SandboxShareResult,
} from '@fruiqo/contracts';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { asc, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, withUser } from '../db/client.js';
import { recommendations, shares, users } from '../db/schema.js';
import { type PipelineFixture, loadFixtures } from '../eval/fixtures.js';
import { scoreShare } from '../eval/metrics.js';
import { FIXTURES_DIR, PipelineGateway } from '../pipeline/gateway.js';
import type { ShareJob } from '../queue/queue.js';
import { SharesService } from '../shares/shares.service.js';
import { buildProcessor } from '../worker-runtime.js';

const REPORTS_DIR = join(dirname(FIXTURES_DIR), 'reports');
const REPORTS_SHOWN = 10;

/**
 * RF-19/RF-22: roda uma fixture sintética em `mock` (sem rede) pelo mesmo caminho do share real
 * (SharesService.create + ShareProcessor) e compara com o `expected.json`. Roda num usuário efêmero,
 * apagado no fim (cascade), para não misturar a fixture com a biblioteca de quem pediu e para o
 * resultado não depender da lista dele (a dedup contra a lista mudaria o esperado).
 */
@Injectable()
export class SandboxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Sandbox só com SANDBOX_ENABLED e fora de produção; fora disso as rotas "não existem". */
  assertEnabled(): void {
    if (!this.env.SANDBOX_ENABLED || this.env.NODE_ENV === 'production') throw new NotFoundException('Não encontrado');
  }

  fixtures(): SandboxFixturesResponse {
    this.assertEnabled();
    return {
      items: this.pipelineFixtures().map((f) => ({ id: f.id, kind: f.kind, description: f.description, shareCount: f.shares.length })),
    };
  }

  async run(fixtureId: string): Promise<SandboxRunResponse> {
    this.assertEnabled();
    const fixture = this.pipelineFixtures().find((f) => f.id === fixtureId);
    if (!fixture) throw new NotFoundException('Fixture não encontrada');

    const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: [FIXTURES_DIR] });
    const processor = buildProcessor(this.env, pino({ level: 'silent' }), this.db, undefined as unknown as Redis, gateway);
    const queue = { add: async () => undefined, remove: async () => undefined } as unknown as Queue<ShareJob>;
    const service = new SharesService(this.db, queue);

    const userId = randomUUID();
    await withUser(this.db, userId, (tx) =>
      tx.insert(users).values({ id: userId, email: `sandbox-${userId}@sandbox.invalid`, passwordHash: 'sandbox' }),
    );
    try {
      const results: SandboxShareResult[] = [];
      for (const [i, input] of fixture.shares.entries()) {
        const body = CreateShareRequestSchema.parse({ clientShareId: randomUUID(), ...input });
        const { share } = await service.create(userId, body, fixture.id);
        await processor.process({ shareId: share.id, userId });
        const steps = await service.steps(userId, share.id);
        const predicted = await withUser(this.db, userId, async (tx) => {
          const [row] = await tx.select().from(shares).where(eq(shares.id, share.id));
          const recs = await tx.select().from(recommendations).where(eq(recommendations.shareId, share.id)).orderBy(asc(recommendations.createdAt));
          return { row: row!, recs };
        });
        const score = scoreShare(
          {
            status: predicted.row.status,
            items: predicted.recs.map((r) => ({
              title: r.title,
              kind: r.kind,
              creator: r.creator,
              decision: r.decision,
              resolutionId: r.resolution?.externalId ?? null,
            })),
            source: { platform: predicted.row.platform, url: predicted.row.sourceUrl },
            dedup: { pagesIgnored: predicted.row.pagesIgnored, itemsAlreadyInList: predicted.row.itemsAlreadyInList },
            costUsd: steps.steps.reduce((sum, s) => sum + s.costEstimateUsd, 0),
          },
          fixture.expected[i] ?? { items: [], forbidden: [] },
          `${fixture.id}#${i + 1}.`,
        );
        results.push({
          status: predicted.row.status,
          items: predicted.recs.map((r) => ({ title: r.title, kind: r.kind, decision: r.decision })),
          steps: steps.steps,
          decisions: steps.decisions,
          diff: {
            tp: score.tp,
            fp: score.fp,
            fn: score.fn,
            missing: score.missing,
            unexpected: score.unexpected,
            failedAssertions: Object.entries(score.assertions).filter(([, ok]) => !ok).map(([id]) => id),
          },
        });
      }
      const passed = results.every((r) => r.diff.fp === 0 && r.diff.fn === 0 && r.diff.failedAssertions.length === 0);
      return { fixtureId: fixture.id, mode: 'mock', passed, shares: results };
    } finally {
      await withUser(this.db, userId, (tx) => tx.delete(users).where(eq(users.id, userId)));
    }
  }

  /** Últimos relatórios de `pnpm eval` (arquivos locais em reports/, gitignored). */
  evals(): SandboxEvalsResponse {
    this.assertEnabled();
    if (!existsSync(REPORTS_DIR)) return { reports: [] };
    const reports = readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .flatMap((file) => {
        try {
          const data = JSON.parse(readFileSync(join(REPORTS_DIR, file), 'utf8')) as {
            label?: unknown;
            createdAt?: unknown;
            metrics?: unknown;
          };
          if (typeof data.createdAt !== 'string' || typeof data.metrics !== 'object' || data.metrics === null) return [];
          return [
            {
              file,
              label: typeof data.label === 'string' ? data.label : 'run',
              createdAt: data.createdAt,
              metrics: data.metrics as Record<string, unknown>,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, REPORTS_SHOWN);
    return { reports };
  }

  private pipelineFixtures(): PipelineFixture[] {
    return loadFixtures([{ dir: FIXTURES_DIR, set: 'public' }]).filter((f): f is PipelineFixture => f.kind !== 'mood-set');
  }
}
