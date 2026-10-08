import { prisma } from "@/server/db/prisma";
import { childLogger } from "@/lib/logger";
import { getEnrichQueue, getScoreQueue } from "./queues";
import { LLM_BATCH_SIZE } from "@/server/services/scoring/scoring.service";

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

  // Each lead is scored against the ICP chosen now, or else the one it is already linked to.
  const linked = opts.icpId ? [] : await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, icpId: true } });
  const linkedIcp = new Map(linked.map((l) => [l.id, l.icpId]));

  await queue.addBulk(
    ids.map((leadId) => ({
      name: "enrich",
      data: { leadId, jobId: job.id, force: !!opts.force, icpId: opts.icpId ?? linkedIcp.get(leadId) ?? null },
      opts: { jobId: `${job.id}__${leadId}` },
    })),
  );
  log.info({ jobId: job.id, count: ids.length, force: !!opts.force }, "enrichment enqueued");
  return { jobId: job.id, queued: ids.length };
}

/** One SCORE job row; its leads are processed in chunks so each LLM request covers a whole batch. */
export async function enqueueScoring(leadIds: string[], icpId: string, opts: { force?: boolean } = {}) {
  const ids = [...new Set(leadIds)];
  if (!ids.length) return { jobId: null, queued: 0 };
  const job = await prisma.job.create({ data: { type: "SCORE", status: "QUEUED", total: ids.length } });
  const queue = getScoreQueue();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LLM_BATCH_SIZE) chunks.push(ids.slice(i, i + LLM_BATCH_SIZE));
  await queue.addBulk(
    chunks.map((leadIds, i) => ({
      name: "score",
      data: { leadIds, icpId, jobId: job.id, force: !!opts.force },
      opts: { jobId: `${job.id}__${i}` },
    })),
  );
  log.info({ jobId: job.id, leads: ids.length, chunks: chunks.length, icpId }, "scoring enqueued");
  return { jobId: job.id, queued: ids.length };
}

export async function selectLeadIds(scope: "new" | "failed" | "unscored" | "all"): Promise<string[]> {
  const where =
    scope === "new"
      ? { status: "NEW" as const }
      : scope === "failed"
        ? { status: "FAILED" as const }
        : scope === "unscored"
          ? { score: null }
          : {};
  const rows = await prisma.lead.findMany({ where, select: { id: true }, take: 5000 });
  return rows.map((r) => r.id);
}

/** Atomically records one finished lead; flips the Job to COMPLETED when the last one lands. */
export async function recordJobProgress(jobId: string, p: { done?: number; failed?: number } = {}): Promise<boolean> {
  const done = p.done ?? 1;
  await prisma.job.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING" } });
  const row = await prisma.job.update({
    where: { id: jobId },
    data: { done: { increment: done }, ...(p.failed ? { failed: { increment: p.failed } } : {}) },
  });
  // Exactly one caller observes the counter crossing `total`, so completion hooks fire once.
  const completed = row.done >= row.total && row.done - done < row.total;
  if (row.done >= row.total && row.status !== "COMPLETED") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
  }
  return completed;
}

export async function listRecentJobs() {
  const [active, recent] = await Promise.all([
    prisma.job.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.job.findMany({ where: { status: { in: ["COMPLETED", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);
  return { active, recent };
}
