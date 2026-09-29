// Backfill do enriquecimento TMDB (2d) e Open Library (livros, RF-48):
//   pnpm --filter @fruiqo/api enrich:backfill -- --email <email> [--include-demo] [--limit N] [--concurrency 2] [--delay-ms 250]
// Reprocessa filmes, séries e livros ainda sem enriquecimento (`none`; com --include-demo também os do
// seed). Usa o PIPELINE_MODE do ambiente: `live` precisa de TMDB_API_KEY para filmes/séries (livros
// usam a Open Library, sem chave; User-Agent com OPENLIBRARY_CONTACT); `mock` usa as gravações
// sintéticas de fixtures/. Nunca imprime a chave.
import { sql } from 'drizzle-orm';
import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { createTitleLookup, EnrichmentService } from '../src/library/enrichment.service.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const env = loadEnv(process.env);
  const email = arg('email')?.trim().toLowerCase();
  if (!email) throw new Error('uso: enrich:backfill -- --email <email> [--include-demo] [--limit N]');
  const lookup = createTitleLookup(env);
  if (!env.TMDB_API_KEY) console.log(`sem TMDB_API_KEY (modo ${env.PIPELINE_MODE}): filmes/séries ficam indisponíveis; livros seguem`);

  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    const found = await db.execute<{ id: string }>(sql`select id from auth_lookup_user(${email})`);
    const userId = found.rows[0]?.id;
    if (!userId) throw new Error('usuário não encontrado');

    const service = new EnrichmentService(db, lookup);
    const examples: string[] = [];
    const noMatch: string[] = [];
    const report = await service.backfill(userId, {
      includeDemo: flag('include-demo'),
      ...(arg('limit') ? { limit: Number(arg('limit')) } : {}),
      concurrency: Number(arg('concurrency') ?? 2),
      delayMs: Number(arg('delay-ms') ?? 250),
      onResult: (title, status, res) => {
        if (status === 'no_match') noMatch.push(title);
        if (status === 'enriched' && res && examples.length < 8) {
          const flat = (res.providers ?? []).filter((p) => p.type === 'flatrate').map((p) => p.name);
          const where = res.provider === 'openlibrary' ? `Open Library${res.authors?.length ? ` · ${res.authors[0]}` : ''}` : flat.length ? flat.join(', ') : 'sem streaming por assinatura no BR';
          examples.push(`${title} → ${res.title}${res.year ? ` (${res.year})` : ''} · ${where}`);
        }
      },
    });
    console.log(`modo ${env.PIPELINE_MODE}: ${report.candidates} candidatos · ${report.enriched} enriquecidos · ${report.noMatch} sem correspondência · ${report.unavailable} indisponíveis · ${report.errors} erros`);
    for (const e of examples) console.log(`  ✓ ${e}`);
    for (const t of noMatch) console.log(`  ✗ sem correspondência: ${t}`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error('falha no backfill:', err.message);
  process.exit(1);
});
