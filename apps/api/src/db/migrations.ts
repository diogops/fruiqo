// Aplica as migrações com a role dona do schema. Usado por scripts/migrate.ts, pelos testes e pelo eval.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// src/db e dist/db ficam na mesma profundidade: ../../drizzle = apps/api/drizzle nos dois casos
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(ownerUrl: string) {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
