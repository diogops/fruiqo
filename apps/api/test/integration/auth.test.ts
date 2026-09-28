import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FAILED_LOGINS } from '../../src/auth/auth.service.js';
import { PASSWORD, register, startTestApp, uniqueEmail } from './app.js';

// Senha fixa só para os testes de falha de login (não é credencial real).
const WRONG_PASSWORD = 'senha-errada-123456'; // gitleaks:allow

let ctx: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  ctx = await startTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});

describe('auth', () => {
  it('registra, faz login e lista sessões', async () => {
    const { accessToken, email } = await register(ctx.http);
    expect(accessToken).toBeTruthy();

    const login = await ctx.http()
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD, deviceName: 'segundo' })
      .expect(200);

    const sessions = await ctx.http()
      .get('/auth/sessions')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(sessions.body).toHaveLength(2);
    expect(sessions.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('nunca devolve hash ou dados internos', async () => {
    const res = await ctx.http()
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, deviceName: 'x' })
      .expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);
  });

  it('rotaciona o refresh e revoga a sessão quando um refresh antigo é reutilizado', async () => {
    const first = await register(ctx.http);

    const second = await ctx.http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    // reuso do refresh já rotacionado → 401 e sessão revogada
    await ctx.http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    // até o refresh novo para de funcionar
    await ctx.http().post('/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
    // e o access token da sessão deixa de valer na hora
    await ctx.http().get('/shares').set('authorization', `Bearer ${second.body.accessToken}`).expect(401);
  });

  it('rejeita refresh forjado', async () => {
    const { refreshToken } = await register(ctx.http);
    const [u, s] = refreshToken.split('.');
    await ctx.http()
      .post('/auth/refresh')
      .send({ refreshToken: `${u}.${s}.${'A'.repeat(43)}` })
      .expect(401);
  });

  it('logout revoga a sessão atual', async () => {
    const { accessToken, refreshToken } = await register(ctx.http);
    await ctx.http().post('/auth/logout').set('authorization', `Bearer ${accessToken}`).expect(204);
    await ctx.http().get('/shares').set('authorization', `Bearer ${accessToken}`).expect(401);
    await ctx.http().post('/auth/refresh').send({ refreshToken }).expect(401);
  });

  it(`bloqueia a conta após ${MAX_FAILED_LOGINS} senhas erradas, mesmo com a senha certa depois`, async () => {
    const { email } = await register(ctx.http);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await ctx.http().post('/auth/login').send({ email, password: WRONG_PASSWORD, deviceName: 'x' }).expect(401);
    }
    const res = await ctx.http().post('/auth/login').send({ email, password: PASSWORD, deviceName: 'x' }).expect(401);
    expect(res.body.message).toMatch(/bloqueada/);
  });

  it('mesma mensagem para e-mail inexistente e senha errada', async () => {
    const { email } = await register(ctx.http);
    const wrong = await ctx.http().post('/auth/login').send({ email, password: WRONG_PASSWORD, deviceName: 'x' });
    const missing = await ctx.http()
      .post('/auth/login')
      .send({ email: uniqueEmail('nobody'), password: WRONG_PASSWORD, deviceName: 'x' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);
  });

  it('rota protegida sem token → 401; health é público', async () => {
    await ctx.http().get('/shares').expect(401);
    await ctx.http().get('/health').expect(200);
  });
});

describe('registro controlado por env (SC-PERSONAL)', () => {
  it('respeita REGISTRATION_ENABLED e ALLOWED_EMAILS', async () => {
    const closed = await startTestApp({ REGISTRATION_ENABLED: 'false' });
    await closed.http().post('/auth/register').send({ email: uniqueEmail(), password: PASSWORD, deviceName: 'x' }).expect(403);
    await closed.app.close();

    const allowlist = await startTestApp({ ALLOWED_EMAILS: 'dono@teste.dev' });
    await allowlist.http().post('/auth/register').send({ email: uniqueEmail(), password: PASSWORD, deviceName: 'x' }).expect(403);
    await allowlist.http().post('/auth/register').send({ email: 'Dono@Teste.dev', password: PASSWORD, deviceName: 'x' }).expect(201);
    await allowlist.app.close();
  });
});
