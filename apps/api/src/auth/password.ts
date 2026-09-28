import { Algorithm, hash, verify } from '@node-rs/argon2';

// argon2id com os parâmetros mínimos recomendados pela OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash fixo para gastar o mesmo tempo quando o e-mail não existe (evita enumeração por tempo). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('fruiqo-dummy-password-for-timing');
  return dummyHash;
}
