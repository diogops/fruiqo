import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

const ISSUER = 'fruiqo-api';
const AUDIENCE = 'fruiqo-app';
const MFA_AUDIENCE = 'fruiqo-mfa';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .setJti(randomUUID())
      .sign(this.key);
  }

  /** Desafio de MFA (5 min): só serve para POST /auth/mfa, não abre sessão. */
  signMfaPending(userId: string, deviceName: string): Promise<string> {
    return new SignJWT({ dev: deviceName })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti(randomUUID())
      .sign(this.key);
  }

  async verifyMfaPending(token: string): Promise<{ userId: string; deviceName: string }> {
    const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: MFA_AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.dev !== 'string') throw new Error('claims ausentes');
    return { userId: payload.sub, deviceName: payload.dev };
  }

  /** Lança se o token for inválido/expirado. */
  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new Error('claims ausentes');
    }
    return { userId: payload.sub, sessionId: payload.sid };
  }
}

/**
 * Refresh token opaco: `<userId>.<sessionId>.<segredo>`. Os IDs não são segredo (só dizem onde
 * procurar sob RLS); o segredo tem 256 bits e só o hash SHA-256 fica no banco.
 */
export function newRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function formatRefreshToken(userId: string, sessionId: string, secret: string): string {
  return `${userId}.${sessionId}.${secret}`;
}

export function parseRefreshToken(
  token: string,
): { userId: string; sessionId: string; secret: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, sessionId, secret] = parts as [string, string, string];
  if (!UUID_RE.test(userId) || !UUID_RE.test(sessionId) || secret.length < 32) return null;
  return { userId, sessionId, secret };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function safeEqualHex(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
