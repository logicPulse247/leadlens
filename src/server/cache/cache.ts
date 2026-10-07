import { getRedis } from "./redis";
import { childLogger } from "@/lib/logger";

const log = childLogger("cache");

/** JSON cache over Redis. Every operation fails open: a Redis outage degrades to cache misses, never to errors. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    log.warn({ err: String(err), key }, "cache get failed");
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    log.warn({ err: String(err), key }, "cache set failed");
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch (err) {
    log.warn({ err: String(err), key }, "cache del failed");
  }
}

/**
 * Fixed-window rate limiter. Returns whether the call is allowed.
 * Fails open if Redis is unreachable.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  try {
    const redis = getRedis();
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
    const ttl = await redis.ttl(k);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(ttl, 0) };
  } catch (err) {
    log.warn({ err: String(err), key }, "rate limit check failed; allowing");
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}
