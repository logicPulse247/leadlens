import { Queue } from "bullmq";
import { getProducerConnection } from "./connection";

export const ENRICH_QUEUE = "leadlens-enrich";

export interface EnrichJobData {
  leadId: string;
  jobId: string;
  force: boolean;
  /** When set, the lead is (re)scored against this ICP right after enrichment. */
  icpId?: string | null;
}

const g = globalThis as unknown as { enrichQueue?: Queue<EnrichJobData> };

export function getEnrichQueue(): Queue<EnrichJobData> {
  if (!g.enrichQueue) {
    g.enrichQueue = new Queue<EnrichJobData>(ENRICH_QUEUE, {
      connection: getProducerConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 3600, count: 2000 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return g.enrichQueue;
}
