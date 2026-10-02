// MFA (TOTP, RFC 6238) e o segredo criptografado.
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecovery, mfaKey, newRecoveryCodes, totpAt, verifyTotp } from '../../src/auth/mfa.js';

// segredo do anexo B da RFC 6238 ("12345678901234567890")
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('vetores da RFC 6238 (SHA1, 6 dígitos)', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('aceita o passo atual e os vizinhos (±30 s), nunca um passo já usado nem formato errado', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null, now)).toBeNull();
  });
});

describe('segredo e recuperação', () => {
  it('criptografa com AES-256-GCM (adulterar falha) e a chave sai do JWT_SECRET ou da variável própria', () => {
    const key = mfaKey({ JWT_SECRET: 'x'.repeat(40) });
    const box = encryptSecret(key, RFC_SECRET);
    expect(box).not.toContain(RFC_SECRET);
    expect(decryptSecret(key, box)).toBe(RFC_SECRET);
    const parts = box.split('.');
    expect(() => decryptSecret(key, [parts[0], parts[1], parts[2], Buffer.from('outro').toString('base64')].join('.'))).toThrow();
    expect(() => mfaKey({ JWT_SECRET: 'x'.repeat(40), MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow();
  });

  it('8 códigos de recuperação distintos; o hash ignora maiúsculas, espaços e hífen', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(hashRecovery(' ABCD-EFGH ')).toBe(hashRecovery('abcdefgh'));
  });
});
