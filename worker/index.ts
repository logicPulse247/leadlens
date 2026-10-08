import "dotenv/config";
import { Worker } from "bullmq";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createBullConnection } from "@/server/queue/connection";
import { handleFinalFailure, handleScoreFailure, processEnrichJob, processScoreJob } from "@/server/queue/processor";
import { ENRICH_QUEUE, SCORE_QUEUE, type EnrichJobData, type ScoreJobData } from "@/server/queue/queues";
import { createDefaultDeps } from "@/server/services/enrichment/pipeline";

const env = getEnv();
const deps = createDefaultDeps();

const enrichWorker = new Worker<EnrichJobData>(ENRICH_QUEUE, (job) => processEnrichJob(job.data, deps), {
  connection: createBullConnection(),
  concurrency: env.ENRICHMENT_CONCURRENCY,
});

const scoreWorker = new Worker<ScoreJobData>(SCORE_QUEUE, (job) => processScoreJob(job.data), {
  connection: createBullConnection(),
  concurrency: 2,
});

enrichWorker.on("ready", () => logger.info({ queue: ENRICH_QUEUE, concurrency: env.ENRICHMENT_CONCURRENCY }, "enrichment worker ready"));
scoreWorker.on("ready", () => logger.info({ queue: SCORE_QUEUE, provider: env.LLM_PROVIDER }, "scoring worker ready"));

enrichWorker.on("failed", async (job, err) => {
  if (!job) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.warn({ jobId: job.id, attempt: job.attemptsMade, exhausted, err: err.message }, "enrich job failed");
  if (exhausted) await handleFinalFailure(job.data, err).catch((e) => logger.error({ err: String(e) }, "failure handler crashed"));
});

scoreWorker.on("failed", async (job, err) => {
  if (!job) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.warn({ jobId: job.id, attempt: job.attemptsMade, exhausted, err: err.message }, "score job failed");
  if (exhausted) await handleScoreFailure(job.data, err).catch((e) => logger.error({ err: String(e) }, "failure handler crashed"));
});

for (const w of [enrichWorker, scoreWorker]) w.on("error", (err) => logger.error({ err: err.message }, "worker error"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  await Promise.all([enrichWorker.close(), scoreWorker.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
