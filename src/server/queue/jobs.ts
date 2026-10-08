import { prisma } from "@/server/db/prisma";
import { childLogger } from "@/lib/logger";
import { getEnrichQueue } from "./queues";

const log = childLogger("jobs");

/**
 * Creates a Job row (what the UI polls) and one BullMQ job per lead.
 * Leads move to ENRICHING immediately so the table reflects queued work.
 */
export async function enqueueEnrichment(leadIds: string[], opts: { force?: boolean; icpId?: string | null } = {}) {
  const ids = [...new Set(leadIds)];
  if (!ids.length) return { jobId: null, queued: 0 };

  const queue = getEnrichQueue();
  const job = await prisma.job.create({ data: { type: "ENRICH", status: "QUEUED", total: ids.length } });

  await prisma.lead.updateMany({
    where: { id: { in: ids }, status: { in: ["NEW", "ENRICHING", "ENRICHED", "FAILED"] } },
    data: { status: "ENRICHING" },
  });

  await queue.addBulk(
    ids.map((leadId) => ({
      name: "enrich",
      data: { leadId, jobId: job.id, force: !!opts.force, icpId: opts.icpId ?? null },
      opts: { jobId: `${job.id}__${leadId}` },
    })),
  );
  log.info({ jobId: job.id, count: ids.length, force: !!opts.force }, "enrichment enqueued");
  return { jobId: job.id, queued: ids.length };
}

export async function selectLeadIds(scope: "new" | "failed" | "unscored"): Promise<string[]> {
  const where =
    scope === "new" ? { status: "NEW" as const } : scope === "failed" ? { status: "FAILED" as const } : { score: null, status: "ENRICHED" as const };
  const rows = await prisma.lead.findMany({ where, select: { id: true }, take: 5000 });
  return rows.map((r) => r.id);
}

/** Atomically records one finished lead; flips the Job to COMPLETED when the last one lands. */
export async function recordJobProgress(jobId: string, failed: boolean) {
  await prisma.job.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING" } });
  const row = await prisma.job.update({
    where: { id: jobId },
    data: { done: { increment: 1 }, ...(failed ? { failed: { increment: 1 } } : {}) },
  });
  if (row.done >= row.total && row.status !== "COMPLETED") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
  }
}

export async function listRecentJobs() {
  const [active, recent] = await Promise.all([
    prisma.job.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.job.findMany({ where: { status: { in: ["COMPLETED", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);
  return { active, recent };
}
