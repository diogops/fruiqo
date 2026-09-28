import type { Redis } from 'ioredis';

/** Quota diária de chamadas caras por usuário (SEC-REQ-06). Retorna false se estourou. */
export async function consumeDailyQuota(
  redis: Redis,
  bucket: string,
  userId: string,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  if (limit <= 0) return false;
  const day = now.toISOString().slice(0, 10);
  const key = `quota:${bucket}:${userId}:${day}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * 24 * 3600);
  return used <= limit;
}
