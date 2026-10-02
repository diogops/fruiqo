// Login com Google: cria a conta (sem senha), entra de novo pelo mesmo `sub`, vincula conta com senha
// pelo e-mail verificado na 1ª vez, recusa outra conta Google no mesmo e-mail e exclui a conta
// confirmando pelo Google. O verificador real é trocado por um falso (o token é a própria identidade).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_VERIFIER, type GoogleIdentity, type GoogleVerifier } from '../../src/auth/google.js';
import { register, startTestApp, uniqueEmail } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;

// credencial falsa: "id:" + JSON da identidade (o tamanho mínimo do contrato é 100)
const cred = (id: GoogleIdentity) => `id:${JSON.stringify(id)}`.padEnd(120, ' ');

beforeAll(async () => {
  ctx = await startTestApp({ GOOGLE_CLIENT_ID: 'cliente-teste.apps.googleusercontent.com' });
  const v = ctx.app.get<GoogleVerifier>(GOOGLE_VERIFIER);
  v.verify = async (c: string) => {
    if (!c.startsWith('id:')) throw new Error('inválido');
    return JSON.parse(c.slice(3).trim()) as GoogleIdentity;
  };
});
afterAll(async () => {
  await ctx.app.close();
});

const google = (id: GoogleIdentity) => ctx.http().post('/auth/google').send({ credential: cred(id), deviceName: 'vitest' });

describe('login com Google', () => {
  it('providers mostra o Client ID', async () => {
    expect((await ctx.http().get('/auth/providers').expect(200)).body).toEqual({ google: { clientId: 'cliente-teste.apps.googleusercontent.com' }, passwordReset: false });
  });

  it('cria a conta sem senha, com o nome do Google; entra de novo pelo mesmo sub; exclui confirmando pelo Google', async () => {
    const id = { sub: `sub-${Date.now()}`, email: uniqueEmail('google'), name: 'Pessoa Google' };
    const first = (await google(id).expect(200)).body;
    expect(first).toMatchObject({ email: id.email, accessToken: expect.any(String), refreshToken: expect.any(String) });
    const auth = { authorization: `Bearer ${first.accessToken}` };
    expect((await ctx.http().get('/profile/settings').set(auth).expect(200)).body).toMatchObject({ displayName: 'Pessoa Google', hasPassword: false });

    // mesmo sub, e-mail trocado no Google: continua a mesma conta
    const again = (await google({ ...id, email: uniqueEmail('trocado') }).expect(200)).body;
    expect(again.email).toBe(id.email);

    // sem senha: não exclui com "senha"; exclui com a confirmação do mesmo Google
    await ctx.http().delete('/account').set(auth).send({ password: 'qualquer-coisa', confirm: 'EXCLUIR' }).expect(401);
    await ctx.http().delete('/account').set(auth).send({ googleCredential: cred({ ...id, sub: 'outro' }), confirm: 'EXCLUIR' }).expect(401);
    await ctx.http().delete('/account').set(auth).send({ googleCredential: cred(id), confirm: 'EXCLUIR' }).expect(204);
  });

  it('conta com senha: vincula pelo e-mail verificado na 1ª vez; outra conta Google no mesmo e-mail é recusada', async () => {
    const email = uniqueEmail('senha');
    await register(ctx.http, email);
    await google({ sub: 'sub-dono', email }).expect(200);
    await google({ sub: 'sub-dono', email }).expect(200);
    await google({ sub: 'sub-intruso', email }).expect(401);
  });

  it('credencial inválida: 401', async () => {
    await ctx.http().post('/auth/google').send({ credential: 'x'.repeat(120), deviceName: 'vitest' }).expect(401);
  });
});
