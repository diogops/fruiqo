import { loadEnv, type Env } from '../src/config/env.js';

// Banco e Redis separados dos de dev; sobrescrevíveis por env.
export const TEST_DB_NAME = 'fruiqo_test';
const PG_HOST = process.env.TEST_PG_HOST ?? '127.0.0.1:55432';

export const OWNER_URL_ADMIN = `postgres://fruiqo_owner:dev_owner_password@${PG_HOST}/fruiqo`;
export const OWNER_URL = `postgres://fruiqo_owner:dev_owner_password@${PG_HOST}/${TEST_DB_NAME}`;
export const APP_URL = `postgres://fruiqo_app:dev_app_password@${PG_HOST}/${TEST_DB_NAME}`;
export const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://:dev_redis_password@127.0.0.1:6379/15';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: APP_URL,
    REDIS_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    REGISTRATION_ENABLED: 'true',
    ALLOWED_EMAILS: '',
    ...overrides,
  });
}
