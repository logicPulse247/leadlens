import { childLogger } from "@/lib/logger";
import { prisma } from "@/server/db/prisma";
import { enrichLead, type EnrichmentDeps } from "@/server/services/enrichment/pipeline";
import { recordJobProgress } from "./jobs";
import type { EnrichJobData } from "./queues";

const log = childLogger("processor");

export async function processEnrichJob(data: EnrichJobData, deps: EnrichmentDeps) {
  const outcome = await enrichLead(data.leadId, deps, { force: data.force });
  const failed = outcome === "failed" || outcome === "blocked" || outcome === "suppressed";
  await recordJobProgress(data.jobId, failed);
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
  await recordJobProgress(data.jobId, true);
}
