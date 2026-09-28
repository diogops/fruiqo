import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TokenPair } from '@fruiqo/contracts';
import request from 'supertest';
import { createApp } from '../../src/bootstrap.js';
import { testEnv } from '../helpers.js';

export async function startTestApp(overrides: Record<string, string> = {}) {
  const app: NestExpressApplication = await createApp(testEnv(overrides));
  await app.init();
  const http = () => request(app.getHttpServer());
  return { app, http };
}

export const PASSWORD = 'senha-de-teste-bem-longa';

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.dev`;
}

export async function register(
  http: Awaited<ReturnType<typeof startTestApp>>['http'],
  email = uniqueEmail(),
): Promise<TokenPair & { email: string }> {
  const res = await http()
    .post('/auth/register')
    .send({ email, password: PASSWORD, deviceName: 'vitest' })
    .expect(201);
  return { ...(res.body as TokenPair), email };
}
