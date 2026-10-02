// "Esqueci minha senha": e-mail só para conta existente (resposta igual sempre), link de uso único que
// troca a senha e encerra as sessões; um pedido a cada 2 min. O envio é capturado (sem SMTP real).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAILER, type Mailer } from '../../src/auth/mail.js';
import { PASSWORD, register, startTestApp, uniqueEmail } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const sent: { to: string; text: string }[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ SMTP_URL: 'smtp://localhost:2525', WEB_APP_URL: 'https://app.teste', AUTH_RATE_LIMIT_PER_MIN: '1000' });
  const m = ctx.app.get<Mailer>(MAILER);
  m.send = async (msg) => {
    sent.push({ to: msg.to, text: msg.text });
  };
});
afterAll(async () => {
  await ctx.app.close();
});

const NEW_PASSWORD = 'senha-nova-bem-longa-2026';

describe('esqueci minha senha', () => {
  it('providers anuncia; conta inexistente não recebe nada; link troca a senha uma vez e derruba as sessões', async () => {
    expect((await ctx.http().get('/auth/providers').expect(200)).body).toMatchObject({ passwordReset: true });
    await ctx.http().post('/auth/password/forgot').send({ email: uniqueEmail('ninguem') }).expect(204);
    expect(sent).toHaveLength(0);

    const email = uniqueEmail('esqueci');
    const session = await register(ctx.http, email);
    await ctx.http().post('/auth/password/forgot').send({ email }).expect(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    const token = /redefinir-senha\?token=([\w-]+)/.exec(sent[0]!.text)![1]!;
    expect(sent[0]!.text).toContain('https://app.teste/redefinir-senha?token=');

    // pedido repetido logo em seguida: não manda outro
    await ctx.http().post('/auth/password/forgot').send({ email }).expect(204);
    expect(sent).toHaveLength(1);

    await ctx.http().post('/auth/password/reset').send({ token: 'x'.repeat(43), password: NEW_PASSWORD }).expect(401);
    await ctx.http().post('/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(204);
    await ctx.http().post('/auth/password/reset').send({ token, password: NEW_PASSWORD }).expect(401);

    await ctx.http().post('/auth/login').send({ email, password: PASSWORD, deviceName: 'vitest' }).expect(401);
    await ctx.http().post('/auth/login').send({ email, password: NEW_PASSWORD, deviceName: 'vitest' }).expect(200);
    // a sessão de antes caiu
    await ctx.http().post('/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
  });
});
