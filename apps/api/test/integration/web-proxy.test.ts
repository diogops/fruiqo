import { WEB_REFRESH_COOKIE } from '@fruiqo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { APP_URL, REDIS_URL } from '../helpers.js';
import { PASSWORD, register, startTestApp } from './app.js';

// D-19: o web em produção chama a API pelo domínio da Vercel (rewrite /api/* → Railway).
const WEB = 'http://localhost:5173';

type Ctx = Awaited<ReturnType<typeof startTestApp>>;
let behindVercel: Ctx;
let direct: Ctx;
let oneHop: Ctx;

beforeAll(async () => {
  behindVercel = await startTestApp({ WEB_ORIGIN: WEB, WEB_COOKIE_PATH: '/api/auth' });
  direct = await startTestApp({ WEB_ORIGIN: WEB });
  oneHop = await startTestApp({ TRUST_PROXY_HOPS: '1' });
});
afterAll(async () => {
  await behindVercel.app.close();
  await direct.app.close();
  await oneHop.app.close();
});

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith(`${WEB_REFRESH_COOKIE}=`));

describe('cookie de refresh atrás do rewrite da Vercel (WEB_COOKIE_PATH)', () => {
  it('usa o caminho configurado no login e no logout', async () => {
    const user = await register(behindVercel.http);
    const login = await behindVercel
      .http()
      .post('/auth/login')
      .set('X-Fruiqo-Client', 'web')
      .set('Origin', WEB)
      .send({ email: user.email, password: PASSWORD, deviceName: 'navegador' })
      .expect(200);
    expect(cookieOf(login)).toMatch(/Path=\/api\/auth(;|$)/);

    const logout = await behindVercel
      .http()
      .post('/auth/logout')
      .set('X-Fruiqo-Client', 'web')
      .set('Origin', WEB)
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);
    expect(cookieOf(logout)).toMatch(/Path=\/api\/auth(;|$)/);
  });

  it('sem configuração continua /auth (dev local e testes antigos)', async () => {
    const user = await register(direct.http);
    const login = await direct
      .http()
      .post('/auth/login')
      .set('X-Fruiqo-Client', 'web')
      .set('Origin', WEB)
      .send({ email: user.email, password: PASSWORD, deviceName: 'navegador' })
      .expect(200);
    expect(cookieOf(login)).toMatch(/Path=\/auth(;|$)/);
  });
});

describe('IP real atrás de proxy (TRUST_PROXY_HOPS)', () => {
  const attempt = (ctx: Ctx, ip: string) =>
    ctx
      .http()
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'ninguem@fruiqo.test', password: 'senha-qualquer-123', deviceName: 'x' });

  it('com 1 salto confiável, IPs diferentes no X-Forwarded-For contam separado no rate limit', async () => {
    const prev = process.env.AUTH_RATE_LIMIT_PER_MIN;
    process.env.AUTH_RATE_LIMIT_PER_MIN = '2';
    try {
      for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
        const res = await attempt(oneHop, ip);
        expect(res.status).not.toBe(429);
      }
    } finally {
      process.env.AUTH_RATE_LIMIT_PER_MIN = prev;
    }
  });

  it('sem salto confiável (padrão), o X-Forwarded-For é ignorado e não burla o rate limit', async () => {
    const prev = process.env.AUTH_RATE_LIMIT_PER_MIN;
    process.env.AUTH_RATE_LIMIT_PER_MIN = '2';
    try {
      const statuses: number[] = [];
      for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) statuses.push((await attempt(direct, ip)).status);
      expect(statuses[2]).toBe(429);
    } finally {
      process.env.AUTH_RATE_LIMIT_PER_MIN = prev;
    }
  });
});

describe('validação do ambiente (SEC-CTRL-49, D-19)', () => {
  const prod = (o: Record<string, string>) => () =>
    loadEnv({ ...testEnvRaw(), NODE_ENV: 'production', PIPELINE_MODE: 'live', ...o } as NodeJS.ProcessEnv);

  it('recusa WEB_ORIGIN http em produção', () => {
    expect(prod({ WEB_ORIGIN: 'http://fruiqo.example' })).toThrow(/WEB_ORIGIN/);
  });
  it('aceita https em produção', () => {
    expect(prod({ WEB_ORIGIN: 'https://fruiqo-web.vercel.app' })).not.toThrow();
  });
  it('recusa WEB_COOKIE_PATH que não seja caminho absoluto', () => {
    expect(prod({ WEB_COOKIE_PATH: 'api/auth' })).toThrow(/WEB_COOKIE_PATH/);
  });
});

/** Mesmo ambiente base dos testes, cru (strings), para validar só as regras de produção. */
function testEnvRaw(): Record<string, string> {
  return {
    LOG_LEVEL: 'silent',
    DATABASE_URL: APP_URL,
    REDIS_URL,
    JWT_SECRET: 'x'.repeat(48),
    REGISTRATION_ENABLED: 'true',
  };
}
