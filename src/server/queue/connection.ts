import IORedis from "ioredis";
import { getEnv } from "@/lib/env";

/** BullMQ requires `maxRetriesPerRequest: null` on its connections, so it can't share the cache client. */
export function createBullConnection(): IORedis {
  return new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
}

const g = globalThis as unknown as { bullProducerConn?: IORedis };

export function getProducerConnection(): IORedis {
  if (!g.bullProducerConn) {
    g.bullProducerConn = createBullConnection();
    g.bullProducerConn.on("error", () => undefined);
  }
  return g.bullProducerConn;
}
