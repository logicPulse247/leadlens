import "dotenv/config";
import { Worker } from "bullmq";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createBullConnection } from "@/server/queue/connection";
import { handleFinalFailure, processEnrichJob } from "@/server/queue/processor";
import { ENRICH_QUEUE, type EnrichJobData } from "@/server/queue/queues";
import { createDefaultDeps } from "@/server/services/enrichment/pipeline";

const env = getEnv();
const deps = createDefaultDeps();

const worker = new Worker<EnrichJobData>(ENRICH_QUEUE, (job) => processEnrichJob(job.data, deps), {
  connection: createBullConnection(),
  concurrency: env.ENRICHMENT_CONCURRENCY,
});

worker.on("ready", () => logger.info({ queue: ENRICH_QUEUE, concurrency: env.ENRICHMENT_CONCURRENCY }, "worker ready"));
worker.on("completed", (job, outcome) => logger.debug({ jobId: job.id, outcome }, "job completed"));
worker.on("failed", async (job, err) => {
  if (!job) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.warn({ jobId: job.id, attempt: job.attemptsMade, exhausted, err: err.message }, "job failed");
  if (exhausted) await handleFinalFailure(job.data, err).catch((e) => logger.error({ err: String(e) }, "failure handler crashed"));
});
worker.on("error", (err) => logger.error({ err: err.message }, "worker error"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
