import { Controller, Get, Inject } from '@nestjs/common';
import type { AiUsageReport } from '@fruiqo/contracts';
import { sql } from 'drizzle-orm';
import { CurrentAuth } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/tokens.js';
import { DB, type Db, withUser } from '../db/client.js';

const DAYS = 30;

/** Resumo do uso de IA do usuário (últimos 30 dias), por recurso e por dia. */
@Controller('profile')
export class AiUsageController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('ai-usage')
  report(@CurrentAuth() auth: AccessClaims): Promise<AiUsageReport> {
    return withUser(this.db, auth.userId, async (tx) => {
      const since = sql`now() - make_interval(days => ${DAYS})`;
      const features = await tx.execute<{ feature: string; calls: number; failures: number; input_tokens: number; output_tokens: number; cost_usd: number; models: string[] }>(sql`
        select feature, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
               coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens,
               coalesce(sum(cost_usd), 0)::float8 as cost_usd, array_agg(distinct model) as models
          from ai_usage where created_at >= ${since}
         group by feature order by cost_usd desc, calls desc`);
      const days = await tx.execute<{ date: string; calls: number; cost_usd: number }>(sql`
        select to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as date, count(*)::int as calls,
               coalesce(sum(cost_usd), 0)::float8 as cost_usd
          from ai_usage where created_at >= ${since}
         group by 1 order by 1 desc`);
      const f = features.rows.map((r) => ({
        feature: r.feature,
        calls: r.calls,
        failures: r.failures,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        costUsd: Number(r.cost_usd),
        models: r.models,
      }));
      return {
        since: new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10),
        total: {
          calls: f.reduce((s, x) => s + x.calls, 0),
          failures: f.reduce((s, x) => s + x.failures, 0),
          inputTokens: f.reduce((s, x) => s + x.inputTokens, 0),
          outputTokens: f.reduce((s, x) => s + x.outputTokens, 0),
          costUsd: f.reduce((s, x) => s + x.costUsd, 0),
        },
        features: f,
        days: days.rows.map((r) => ({ date: r.date, calls: r.calls, costUsd: Number(r.cost_usd) })),
      };
    });
  }
}
