// MFA por TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 dígitos), compatível com Google Authenticator, Authy,
// 1Password etc. O segredo fica criptografado no banco (AES-256-GCM); códigos de recuperação só como
// hash. Aceita o passo atual e os vizinhos (±30 s de relógio), nunca um passo já usado.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código TOTP de um passo (usado também nos testes). */
export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Confere o código no passo atual e nos vizinhos. Devolve o passo aceito (para gravar e não aceitar
 * de novo) ou null. `lastStep`: o último passo já usado.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(totpAt(secretB32, s));
    if (timingSafeEqual(expected, Buffer.from(clean))) return s;
  }
  return null;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(secretB32: string, account: string): string {
  const label = encodeURIComponent(`Fruiqo:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=Fruiqo&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------- recuperação

/** 8 códigos "abcd-efgh" (40 bits cada); o usuário guarda, o banco só tem o hash. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const c = base32Encode(randomBytes(5)).toLowerCase();
    return `${c.slice(0, 4)}-${c.slice(4, 8)}`;
  });
}

export const hashRecovery = (code: string) => createHash('sha256').update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

// ---------------------------------------------------------------- segredo criptografado

/** Chave do MFA: MFA_ENCRYPTION_KEY (base64, 32 bytes) ou derivada do JWT_SECRET. */
export function mfaKey(env: { MFA_ENCRYPTION_KEY?: string; JWT_SECRET: string }): Buffer {
  if (env.MFA_ENCRYPTION_KEY) {
    const k = Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new Error('MFA_ENCRYPTION_KEY precisa ter 32 bytes (base64)');
    return k;
  }
  return createHash('sha256').update(`fruiqo-mfa:${env.JWT_SECRET}`).digest();
}

export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(key: Buffer, box: string): string {
  const [v, iv, tag, data] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('segredo de MFA inválido');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
