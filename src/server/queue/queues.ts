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

export const SCORE_QUEUE = "leadlens-score";

export interface ScoreJobData {
  leadIds: string[];
  icpId: string;
  jobId: string;
  force: boolean;
}

const gs = globalThis as unknown as { scoreQueue?: Queue<ScoreJobData> };

export function getScoreQueue(): Queue<ScoreJobData> {
  if (!gs.scoreQueue) {
    gs.scoreQueue = new Queue<ScoreJobData>(SCORE_QUEUE, {
      connection: getProducerConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return gs.scoreQueue;
}
