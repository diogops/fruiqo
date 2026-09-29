// pnpm eval (RF-22): roda as fixtures no pipeline real em PIPELINE_MODE=mock (sem rede, custo zero)
// e gera relatório de detecção/tipo/resolução/revisão, humor (RNF-07) e custo.
//
//   pnpm eval [--set public|private|all] [--label v1] [--compare <arquivo.json>] [--check] [--write-baseline]
//
// --check falha (exit 1) se: recall de risco < 100% (RNF-07), F1 cair em relação à baseline, ou uma
// checagem que passava na baseline passar a falhar. A baseline versionada é a `v1-review-txt` (RF-42/47;
// a `v0-heuristic` fica como histórico).
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateShareRequestSchema } from '@fruiqo/contracts';
import { asc, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { pino } from 'pino';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { loadEnv } from '../config/env.js';
import { createDb, withUser } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { pipelineStepLogs, recommendations, shares, users } from '../db/schema.js';
import { FIXTURES_DIR, FIXTURES_PRIVATE_DIR, PipelineGateway } from '../pipeline/gateway.js';
import type { ShareJob } from '../queue/queue.js';
import { SharesService } from '../shares/shares.service.js';
import { buildProcessor } from '../worker-runtime.js';
import { type Fixture, loadFixtures, type PipelineFixture } from './fixtures.js';
import { f1, type MoodScore, type PredictedShare, ratio, scoreMood, scoreShare, type ShareScore } from './metrics.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASELINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../eval-baselines');
const PG_HOST = process.env.EVAL_PG_HOST ?? process.env.TEST_PG_HOST ?? '127.0.0.1:55432';
const EVAL_DB = 'fruiqo_eval';
const OWNER_ADMIN = `postgres://fruiqo_owner:dev_owner_password@${PG_HOST}/fruiqo`;
const OWNER_URL = `postgres://fruiqo_owner:dev_owner_password@${PG_HOST}/${EVAL_DB}`;
const APP_URL = `postgres://fruiqo_app:dev_app_password@${PG_HOST}/${EVAL_DB}`;

interface Args {
  set: 'public' | 'private' | 'all';
  label: string;
  compare?: string;
  check: boolean;
  writeBaseline: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { set: 'public', label: 'run', check: false, writeBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') args.set = argv[++i] as Args['set'];
    else if (a === '--label') args.label = argv[++i] ?? 'run';
    else if (a === '--compare') args.compare = argv[++i];
    else if (a === '--check') args.check = true;
    else if (a === '--write-baseline') args.writeBaseline = true;
  }
  if (!['public', 'private', 'all'].includes(args.set)) throw new Error('--set deve ser public, private ou all');
  return args;
}

export interface EvalReport {
  label: string;
  set: string;
  pipelineMode: 'mock';
  gitSha: string | null;
  createdAt: string;
  metrics: {
    precision: number | null;
    recall: number | null;
    f1: number | null;
    kindAccuracy: number | null;
    resolutionAccuracy: number | null;
    reviewRate: number | null;
    assertionsPassed: number;
    assertionsTotal: number;
    riskRecall: number | null;
    riskFalsePositiveRate: number | null;
    intentConvergence: number | null;
    costUsd: number;
  };
  failingAssertions: string[];
  perFixture: { id: string; kind: string; tp: number; fp: number; fn: number; missing: string[]; unexpected: string[]; failed: string[] }[];
  moodFailures: string[];
}

async function prepareDb() {
  const admin = new pg.Client({ connectionString: OWNER_ADMIN });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${EVAL_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${EVAL_DB}`);
    await admin.query(`GRANT CONNECT ON DATABASE ${EVAL_DB} TO fruiqo_app`);
  } finally {
    await admin.end();
  }
  await runMigrations(OWNER_URL);
}

async function runPipelineFixtures(fixtures: PipelineFixture[], set: Args['set']) {
  // RF-20: no eval a rede fica bloqueada; o gateway em mock nunca chama fetch real
  globalThis.fetch = (async () => {
    throw new Error('rede bloqueada no eval (PIPELINE_MODE=mock)');
  }) as typeof fetch;

  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: APP_URL,
    REDIS_URL: 'redis://127.0.0.1:6379/15',
    // o eval não emite tokens; um segredo aleatório por execução satisfaz a validação do env
    JWT_SECRET: randomBytes(32).toString('hex'),
    PIPELINE_MODE: 'mock',
  });
  const dirs = set === 'public' ? [FIXTURES_DIR] : set === 'private' ? [FIXTURES_PRIVATE_DIR] : [FIXTURES_DIR, FIXTURES_PRIVATE_DIR];
  const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: dirs });
  const { db, pool } = createDb(APP_URL);
  const logger = pino({ level: 'silent' });
  // Redis só é usado pela quota do LLM, que fica desligado no eval
  const processor = buildProcessor(env, logger, db, undefined as unknown as Redis, gateway);
  const queue = { add: async () => undefined, remove: async () => undefined } as unknown as Queue<ShareJob>;
  const service = new SharesService(db, queue);

  const results: { fixture: PipelineFixture; predicted: PredictedShare[] }[] = [];
  try {
    for (const fixture of fixtures) {
      const userId = randomUUID();
      await withUser(db, userId, (tx) =>
        tx.insert(users).values({ id: userId, email: `${fixture.id}-${userId.slice(0, 6)}@eval.test`, passwordHash: 'x' }),
      );
      const predicted: PredictedShare[] = [];
      for (const input of fixture.shares) {
        // mesmo ponto de entrada do share real: validação do contrato + SharesService.create
        const body = CreateShareRequestSchema.parse({ clientShareId: randomUUID(), ...input });
        const { share } = await service.create(userId, body, fixture.id);
        await processor.process({ shareId: share.id, userId });
        predicted.push(await readShare(db, userId, share.id));
      }
      results.push({ fixture, predicted });
    }
  } finally {
    await pool.end();
  }
  return results;
}

async function readShare(db: ReturnType<typeof createDb>['db'], userId: string, shareId: string): Promise<PredictedShare> {
  return withUser(db, userId, async (tx) => {
    const [row] = await tx.select().from(shares).where(eq(shares.id, shareId));
    const recs = await tx.select().from(recommendations).where(inArray(recommendations.shareId, [shareId])).orderBy(asc(recommendations.createdAt));
    const steps = await tx.select().from(pipelineStepLogs).where(eq(pipelineStepLogs.shareId, shareId));
    return {
      status: row!.status,
      items: recs.map((r) => ({
        title: r.title,
        kind: r.kind,
        creator: r.creator,
        // RF-42: tudo entra na revisão; a taxa de revisão mede a sugestão do pipeline
        decision: r.suggestedDecision ?? r.decision,
        resolutionId: r.resolution?.externalId ?? null,
      })),
      source: { platform: row!.platform, url: row!.sourceUrl },
      dedup: { pagesIgnored: row!.pagesIgnored, itemsAlreadyInList: row!.itemsAlreadyInList },
      costUsd: steps.reduce((sum, s) => sum + s.costEstimateUsd, 0),
    };
  });
}

function gitSha(): string | null {
  try {
    const head = readFileSync(join(REPO_ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 12);
    const ref = join(REPO_ROOT, '.git', head.slice(5));
    return existsSync(ref) ? readFileSync(ref, 'utf8').trim().slice(0, 12) : null;
  } catch {
    return null;
  }
}

export function buildReport(
  args: Pick<Args, 'label' | 'set'>,
  pipeline: { fixture: PipelineFixture; predicted: PredictedShare[] }[],
  mood: MoodScore,
): EvalReport {
  let tp = 0, fp = 0, fn = 0, kindHits = 0, resHits = 0, resExp = 0, review = 0, predictedCount = 0, cost = 0;
  const failing: string[] = [];
  let passed = 0, total = 0;
  const perFixture: EvalReport['perFixture'] = [];
  for (const { fixture, predicted } of pipeline) {
    const scores: ShareScore[] = fixture.expected.map((exp, i) =>
      scoreShare(predicted[i] ?? { status: 'missing', items: [], source: { platform: '', url: null }, dedup: { pagesIgnored: -1, itemsAlreadyInList: -1 }, costUsd: 0 }, exp, `${fixture.id}#${i}:`),
    );
    const failed: string[] = [];
    for (const s of scores) {
      tp += s.tp; fp += s.fp; fn += s.fn; kindHits += s.kindHits; resHits += s.resolutionHits; resExp += s.resolutionExpected; review += s.review;
      predictedCount += s.tp + s.fp;
      for (const [id, ok] of Object.entries(s.assertions)) {
        total++;
        if (ok) passed++;
        else failed.push(id);
      }
    }
    cost += predicted.reduce((sum, p) => sum + p.costUsd, 0);
    failing.push(...failed);
    perFixture.push({
      id: fixture.id,
      kind: fixture.kind,
      tp: scores.reduce((n, s) => n + s.tp, 0),
      fp: scores.reduce((n, s) => n + s.fp, 0),
      fn: scores.reduce((n, s) => n + s.fn, 0),
      missing: scores.flatMap((s) => s.missing),
      unexpected: scores.flatMap((s) => s.unexpected),
      failed,
    });
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    label: args.label,
    set: args.set,
    pipelineMode: 'mock',
    gitSha: gitSha(),
    createdAt: new Date().toISOString(),
    metrics: {
      precision,
      recall,
      f1: f1(precision, recall),
      kindAccuracy: ratio(kindHits, tp),
      resolutionAccuracy: ratio(resHits, resExp),
      reviewRate: ratio(review, predictedCount),
      assertionsPassed: passed,
      assertionsTotal: total,
      riskRecall: ratio(mood.riskDetected, mood.riskPositives),
      riskFalsePositiveRate: ratio(mood.riskFalsePositives, mood.riskNegatives),
      intentConvergence: ratio(mood.intentConverged, mood.intentCases),
      costUsd: cost,
    },
    failingAssertions: failing,
    perFixture,
    moodFailures: mood.failures,
  };
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function toMarkdown(r: EvalReport, base?: EvalReport): string {
  const m = r.metrics;
  const b = base?.metrics;
  const row = (name: string, key: keyof EvalReport['metrics'], fmt = pct) =>
    `| ${name} | ${fmt(m[key] as number | null)} | ${b ? fmt(b[key] as number | null) : '—'} |`;
  const lines = [
    `# Eval ${r.label}`,
    '',
    `set \`${r.set}\` · modo \`${r.pipelineMode}\` · git \`${r.gitSha ?? '—'}\` · ${r.createdAt}${base ? ` · comparado com \`${base.label}\`` : ''}`,
    '',
    '| Métrica | Atual | Base |',
    '|---|---|---|',
    row('Precision (detecção)', 'precision'),
    row('Recall (detecção)', 'recall'),
    row('F1 (detecção)', 'f1'),
    row('Acerto de kind', 'kindAccuracy'),
    row('Acerto de resolução', 'resolutionAccuracy'),
    row('Taxa de revisão', 'reviewRate'),
    `| Checagens | ${m.assertionsPassed}/${m.assertionsTotal} | ${b ? `${b.assertionsPassed}/${b.assertionsTotal}` : '—'} |`,
    row('Recall de risco (RNF-07)', 'riskRecall'),
    row('Falso positivo de risco', 'riskFalsePositiveRate'),
    row('Convergência de intenção', 'intentConvergence'),
    `| Custo estimado | US$ ${m.costUsd.toFixed(4)} | ${b ? `US$ ${b.costUsd.toFixed(4)}` : '—'} |`,
    '',
    '## Por fixture',
    '',
    '| Fixture | Tipo | TP | FP | FN | Faltaram | Sobraram | Checagens que falharam |',
    '|---|---|---|---|---|---|---|---|',
    ...r.perFixture.map(
      (f) =>
        `| ${f.id} | ${f.kind} | ${f.tp} | ${f.fp} | ${f.fn} | ${f.missing.join('; ') || '—'} | ${f.unexpected.join('; ') || '—'} | ${f.failed.map((x) => x.split(':').slice(1).join(':')).join('; ') || '—'} |`,
    ),
  ];
  if (r.moodFailures.length) lines.push('', '## Humor', '', ...r.moodFailures.map((f) => `- ${f}`));
  return `${lines.join('\n')}\n`;
}

/** Regressões que fazem o --check falhar. */
export function regressions(r: EvalReport, base?: EvalReport): string[] {
  const out: string[] = [];
  if (r.metrics.riskRecall !== null && r.metrics.riskRecall < 1) out.push('recall de risco abaixo de 100% (RNF-07)');
  if (!base) return out;
  if ((r.metrics.f1 ?? 0) + 1e-9 < (base.metrics.f1 ?? 0)) out.push(`F1 caiu: ${pct(r.metrics.f1)} < ${pct(base.metrics.f1)}`);
  const baseFailing = new Set(base.failingAssertions);
  const newlyFailing = r.failingAssertions.filter((a) => !baseFailing.has(a));
  if (newlyFailing.length) out.push(`checagens que passavam e agora falham: ${newlyFailing.join(', ')}`);
  if ((r.metrics.intentConvergence ?? 1) + 1e-9 < (base.metrics.intentConvergence ?? 0)) out.push('convergência de intenção caiu');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dirs =
    args.set === 'public'
      ? [{ dir: FIXTURES_DIR, set: 'public' as const }]
      : args.set === 'private'
        ? [{ dir: FIXTURES_PRIVATE_DIR, set: 'private' as const }]
        : [{ dir: FIXTURES_DIR, set: 'public' as const }, { dir: FIXTURES_PRIVATE_DIR, set: 'private' as const }];
  const fixtures: Fixture[] = loadFixtures(dirs);
  const pipelineFixtures = fixtures.filter((f): f is PipelineFixture => f.kind !== 'mood-set');
  const mood = scoreMood(fixtures.flatMap((f) => (f.kind === 'mood-set' ? f.cases : [])));

  await prepareDb();
  const pipeline = await runPipelineFixtures(pipelineFixtures, args.set);
  const report = buildReport(args, pipeline, mood);

  const baselinePath = args.compare ?? join(BASELINE_DIR, 'v1-review-txt.json');
  const base = existsSync(baselinePath) && !args.writeBaseline ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalReport) : undefined;

  const reportsDir = join(REPO_ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.createdAt.replace(/[:.]/g, '-');
  const md = toMarkdown(report, base);
  writeFileSync(join(reportsDir, `eval-${args.label}-${stamp}.md`), md);
  writeFileSync(join(reportsDir, `eval-${args.label}-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  if (args.writeBaseline) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(join(BASELINE_DIR, `${args.label}.json`), `${JSON.stringify({ ...report, createdAt: report.createdAt }, null, 2)}\n`);
  }
  console.log(md);

  if (args.check) {
    const problems = regressions(report, base);
    if (problems.length) {
      console.error(`eval --check falhou:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log('eval --check ok');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => {
    console.error('eval falhou:', err.message);
    process.exit(1);
  });
}
