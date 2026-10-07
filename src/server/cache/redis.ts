import IORedis from "ioredis";
import { getEnv } from "@/lib/env";

const g = globalThis as unknown as { redis?: IORedis };

/** Shared connection for cache + rate limiting. BullMQ needs its own connections (see queue/connection.ts). */
export function getRedis(): IORedis {
  if (!g.redis) {
    g.redis = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
    });
    g.redis.on("error", () => {
      /* surfaced via /api/health and cache fallbacks */
    });
  }
  return g.redis;
}
