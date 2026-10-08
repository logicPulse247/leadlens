import { childLogger } from "@/lib/logger";
import { getRedis } from "@/server/cache/redis";
import { prisma } from "@/server/db/prisma";
import { enrichLead, type EnrichmentDeps } from "@/server/services/enrichment/pipeline";
import { scoreLeads } from "@/server/services/scoring/scoring.service";
import { enqueueScoring, recordJobProgress } from "./jobs";
import type { EnrichJobData, ScoreJobData } from "./queues";

const log = childLogger("processor");

const pendingKey = (jobId: string, icpId: string) => `score-pending:${jobId}:${icpId}`;
const icpsKey = (jobId: string) => `score-icps:${jobId}`;

/**
 * Leads finished by an enrichment job are collected and scored together once the whole job
 * completes, so the LLM sees full batches instead of one company per request.
 */
async function finishEnrichLead(data: EnrichJobData, opts: { failed: boolean; scorable: boolean }) {
  if (data.icpId && opts.scorable) {
    try {
      const redis = getRedis();
      await redis.sadd(pendingKey(data.jobId, data.icpId), data.leadId);
      await redis.sadd(icpsKey(data.jobId), data.icpId);
      await redis.expire(pendingKey(data.jobId, data.icpId), 24 * 3600);
      await redis.expire(icpsKey(data.jobId), 24 * 3600);
    } catch (err) {
      log.warn({ err: String(err) }, "could not record lead for scoring");
    }
  }
  const completed = await recordJobProgress(data.jobId, { done: 1, failed: opts.failed ? 1 : 0 });
  if (completed) {
    const redis = getRedis();
    for (const icpId of await redis.smembers(icpsKey(data.jobId))) {
      const ids = await redis.smembers(pendingKey(data.jobId, icpId));
      await redis.del(pendingKey(data.jobId, icpId));
      if (ids.length) await enqueueScoring(ids, icpId, { force: true });
    }
    await redis.del(icpsKey(data.jobId));
  }
}

export async function processEnrichJob(data: EnrichJobData, deps: EnrichmentDeps) {
  const outcome = await enrichLead(data.leadId, deps, { force: data.force });
  const failed = outcome === "failed" || outcome === "blocked" || outcome === "suppressed";
  await finishEnrichLead(data, { failed, scorable: outcome !== "suppressed" });
  return outcome;
}

/** Called once BullMQ has exhausted retries: the lead must not stay stuck in ENRICHING. */
export async function handleFinalFailure(data: EnrichJobData, err: Error) {
  log.error({ leadId: data.leadId, err: err.message }, "enrichment failed permanently");
  await prisma.lead.updateMany({ where: { id: data.leadId, status: "ENRICHING" }, data: { status: "FAILED" } });
  await prisma.enrichment.upsert({
    where: { leadId: data.leadId },
    create: { leadId: data.leadId, error: err.message.slice(0, 300), expiresAt: new Date(Date.now() + 3600_000) },
    update: { error: err.message.slice(0, 300), expiresAt: new Date(Date.now() + 3600_000) },
  });
  await finishEnrichLead(data, { failed: true, scorable: true });
}

export async function processScoreJob(data: ScoreJobData) {
  const stats = await scoreLeads(data.leadIds, data.icpId, { force: data.force });
  await recordJobProgress(data.jobId, { done: data.leadIds.length, failed: stats.llmFailures });
  return stats;
}

export async function handleScoreFailure(data: ScoreJobData, err: Error) {
  log.error({ jobId: data.jobId, err: err.message }, "scoring chunk failed permanently");
  await recordJobProgress(data.jobId, { done: data.leadIds.length, failed: data.leadIds.length });
}
