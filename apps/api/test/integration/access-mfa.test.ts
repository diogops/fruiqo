// Acesso controlado pelo administrador + MFA: e-mail novo vira pedido; o administrador (com MFA, numa
// sessão verificada) aprova ou revoga; login com MFA exige o código (ou um de recuperação, uma vez só).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentStep, totpAt } from '../../src/auth/mfa.js';
import { PASSWORD, startTestApp, uniqueEmail } from './app.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;
const ADMIN = uniqueEmail('admin');

beforeAll(async () => {
  ctx = await startTestApp({ ADMIN_EMAILS: ADMIN, AUTH_RATE_LIMIT_PER_MIN: '1000' });
});
afterAll(async () => {
  await ctx.app.close();
});

const register = (email: string) => ctx.http().post('/auth/register').send({ email, password: PASSWORD, deviceName: 'vitest' });
const login = (email: string) => ctx.http().post('/auth/login').send({ email, password: PASSWORD, deviceName: 'vitest' });
const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('acesso controlado e MFA', () => {
  it('pedido → MFA do administrador → aprovação → login com código → revogação', async () => {
    // administrador entra sempre; e-mail novo vira pedido
    const admin = (await register(ADMIN).expect(201)).body;
    const other = uniqueEmail('convidado');
    const pending = (await register(other).expect(403)).body;
    expect(pending).toMatchObject({ code: 'access_pending' });
    expect((await ctx.http().get('/profile/settings').set(as(admin.accessToken)).expect(200)).body).toMatchObject({ isAdmin: true, mfaEnabled: false });

    // sem MFA, a administração pede para ativar
    expect((await ctx.http().get('/admin/access').set(as(admin.accessToken)).expect(403)).body).toMatchObject({ code: 'mfa_setup_required' });
    const setup = (await ctx.http().post('/account/mfa/setup').set(as(admin.accessToken)).expect(200)).body;
    expect(setup.otpauthUrl).toContain('otpauth://totp/Fruiqo');
    await ctx.http().post('/account/mfa/enable').set(as(admin.accessToken)).send({ code: '000000' }).expect(401);
    const step = currentStep();
    const enabled = (await ctx.http().post('/account/mfa/enable').set(as(admin.accessToken)).send({ code: totpAt(setup.secret, step) }).expect(200)).body;
    expect(enabled.recoveryCodes).toHaveLength(8);

    // esta sessão passou pelo MFA: vê o pedido e aprova
    const list = (await ctx.http().get('/admin/access').set(as(admin.accessToken)).expect(200)).body;
    expect(list.configured).toContain(ADMIN.toLowerCase());
    expect(list.entries.find((e: { email: string }) => e.email === other)).toMatchObject({ status: 'pending', hasAccount: false });
    await ctx.http().put('/admin/access').set(as(admin.accessToken)).send({ email: other, status: 'approved' }).expect(204);
    const guest = (await register(other).expect(201)).body;

    // convidado não entra na administração
    await ctx.http().get('/admin/access').set(as(guest.accessToken)).expect(403);

    // login do administrador agora pede o código; o mesmo passo do código não vale de novo
    const challenge = (await login(ADMIN).expect(200)).body;
    expect(challenge).toMatchObject({ mfaRequired: true });
    expect(challenge.accessToken).toBeUndefined();
    await ctx.http().post('/auth/mfa').send({ mfaToken: challenge.mfaToken, code: totpAt(setup.secret, step) }).expect(401);
    const viaApp = (await ctx.http().post('/auth/mfa').send({ mfaToken: challenge.mfaToken, code: totpAt(setup.secret, step + 1) }).expect(200)).body;
    expect(viaApp).toMatchObject({ email: ADMIN.toLowerCase(), accessToken: expect.any(String) });
    await ctx.http().get('/admin/access').set(as(viaApp.accessToken)).expect(200);

    // código de recuperação vale uma vez
    const c2 = (await login(ADMIN).expect(200)).body;
    await ctx.http().post('/auth/mfa').send({ mfaToken: c2.mfaToken, code: enabled.recoveryCodes[0] }).expect(200);
    const c3 = (await login(ADMIN).expect(200)).body;
    await ctx.http().post('/auth/mfa').send({ mfaToken: c3.mfaToken, code: enabled.recoveryCodes[0] }).expect(401);

    // sessão sem MFA (senha só, antes de ligar) não abre a administração: a do convidado nem é admin;
    // revogação: o convidado não entra mais e o refresh dele cai
    await ctx.http().put('/admin/access').set(as(viaApp.accessToken)).send({ email: other, status: 'denied' }).expect(204);
    expect((await login(other).expect(403)).body).toMatchObject({ code: 'access_pending' });
    await ctx.http().post('/auth/refresh').send({ refreshToken: guest.refreshToken }).expect(401);
    // o administrador não revoga a si mesmo
    await ctx.http().put('/admin/access').set(as(viaApp.accessToken)).send({ email: ADMIN, status: 'denied' }).expect(403);
  });
});
