// Aplica as migrações com a role dona do schema (DATABASE_URL_OWNER).
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrations.js';

export { runMigrations };

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
