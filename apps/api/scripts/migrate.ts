// Aplica as migrações com a role dona do schema (DATABASE_URL_OWNER).
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(ownerUrl: string) {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error('DATABASE_URL_OWNER não definido');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('migrações aplicadas'))
    .catch((err: Error) => {
      console.error('falha na migração:', err.message);
      process.exit(1);
    });
}
