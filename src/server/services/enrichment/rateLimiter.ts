import { getRedis } from "@/server/cache/redis";

export interface DomainRateLimiter {
  /** Resolves when it is polite to hit `host` again. Guarantees at least `minDelayMs` between grants per host. */
  acquire(host: string, minDelayMs: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cross-process per-domain throttle backed by Redis (`SET NX PX`).
 * All workers share the same slot per host, so concurrency never turns into a burst against one site.
 * Falls back to an in-process timer if Redis is unavailable.
 */
export class RedisDomainRateLimiter implements DomainRateLimiter {
  private readonly local = new Map<string, number>();

  async acquire(host: string, minDelayMs: number): Promise<void> {
    if (minDelayMs <= 0) return;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const redis = getRedis();
        const ok = await redis.set(`crawl:${host}`, "1", "PX", minDelayMs, "NX");
        if (ok === "OK") return;
        const ttl = await redis.pttl(`crawl:${host}`);
        await sleep(Math.min(Math.max(ttl, 25), minDelayMs) + Math.random() * 50);
      } catch {
        return this.acquireLocal(host, minDelayMs);
      }
    }
  }

  private async acquireLocal(host: string, minDelayMs: number) {
    const next = this.local.get(host) ?? 0;
    const wait = Math.max(0, next - Date.now());
    this.local.set(host, Math.max(next, Date.now()) + minDelayMs);
    if (wait) await sleep(wait);
  }
}

/** For tests and synthetic sites, where no real server is being contacted. */
export class NoopRateLimiter implements DomainRateLimiter {
  async acquire(): Promise<void> {}
}
