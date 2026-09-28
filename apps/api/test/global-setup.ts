import pg from 'pg';
import { runMigrations } from '../scripts/migrate.js';
import { OWNER_URL, OWNER_URL_ADMIN, TEST_DB_NAME } from './helpers.js';

/** Recria o banco de teste do zero e aplica as migrações reais (inclui RLS). */
export default async function setup() {
  const admin = new pg.Client({ connectionString: OWNER_URL_ADMIN });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    await admin.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO fruiqo_app`);
  } finally {
    await admin.end();
  }
  await runMigrations(OWNER_URL);
}
