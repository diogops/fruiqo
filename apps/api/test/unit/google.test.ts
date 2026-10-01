// Login com Google: o ID token só passa com assinatura válida, emissor do Google, destinatário = nosso
// Client ID, dentro da validade e com e-mail verificado. Chaves locais (sem rede).
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { googleVerifier } from '../../src/auth/google.js';

const CLIENT = 'cliente-teste.apps.googleusercontent.com';
let sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string; key?: CryptoKey }) => Promise<string>;
let verifier: ReturnType<typeof googleVerifier>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  verifier = googleVerifier(CLIENT, createLocalJWKSet({ keys: [jwk] }));
  sign = (claims, o = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(o.iss ?? 'https://accounts.google.com')
      .setAudience(o.aud ?? CLIENT)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(o.key ?? privateKey);
});

const good = { sub: '1234567890', email: 'Pessoa@Gmail.com', email_verified: true, name: 'Pessoa Teste' };

describe('googleVerifier', () => {
  it('token válido: sub, e-mail normalizado e nome', async () => {
    expect(await verifier.verify(await sign(good))).toEqual({ sub: '1234567890', email: 'pessoa@gmail.com', name: 'Pessoa Teste' });
  });

  it('recusa: outro destinatário, outro emissor, vencido, e-mail não verificado, assinatura de outra chave', async () => {
    await expect(verifier.verify(await sign(good, { aud: 'outro-app' }))).rejects.toThrow();
    await expect(verifier.verify(await sign(good, { iss: 'https://evil.example' }))).rejects.toThrow();
    await expect(verifier.verify(await sign(good, { exp: '-10m' }))).rejects.toThrow();
    await expect(verifier.verify(await sign({ ...good, email_verified: false }))).rejects.toThrow(/verificado/);
    await expect(verifier.verify(await sign(good, { key: otherKey }))).rejects.toThrow();
  });
});
