import { prisma } from "@/server/db/prisma";
import { childLogger } from "@/lib/logger";
import { findMergeCandidates } from "./match";

const log = childLogger("dedupe");

export async function bumpDuplicatesRemoved(by: number) {
  if (by <= 0) return;
  await prisma.counter.upsert({
    where: { key: "duplicatesRemoved" },
    update: { value: { increment: by } },
    create: { key: "duplicatesRemoved", value: by },
  });
}

/** Recomputes fuzzy-name merge candidates. Dismissed and merged pairs are never resurfaced. */
export async function refreshMergeCandidates(): Promise<number> {
  const leads = await prisma.lead.findMany({ select: { id: true, name: true, domain: true, location: true } });
  const pairs = findMergeCandidates(leads);
  if (!pairs.length) return 0;

  const existing = await prisma.mergeCandidate.findMany({ select: { leadAId: true, leadBId: true } });
  const known = new Set(existing.map((e) => `${e.leadAId}|${e.leadBId}`));
  const fresh = pairs.filter((p) => !known.has(`${p.aId}|${p.bId}`));
  if (fresh.length) {
    await prisma.mergeCandidate.createMany({
      data: fresh.map((p) => ({ leadAId: p.aId, leadBId: p.bId, similarity: p.similarity, reason: p.reason })),
      skipDuplicates: true,
    });
  }
  log.info({ found: pairs.length, created: fresh.length }, "merge candidates refreshed");
  return fresh.length;
}

export async function listMergeCandidates() {
  return prisma.mergeCandidate.findMany({
    where: { status: "PENDING" },
    orderBy: { similarity: "desc" },
    include: {
      leadA: { select: { id: true, name: true, domain: true, location: true, industry: true, employees: true, score: true } },
      leadB: { select: { id: true, name: true, domain: true, location: true, industry: true, employees: true, score: true } },
    },
  });
}

export async function dismissCandidate(id: string) {
  return prisma.mergeCandidate.update({ where: { id }, data: { status: "DISMISSED" } });
}

/**
 * Merges `dropId` into `keepId`: fills blank fields on the survivor, moves enrichment/drafts
 * if the survivor has none, then deletes the duplicate.
 */
export async function mergeLeads(keepId: string, dropId: string) {
  if (keepId === dropId) throw new Error("Cannot merge a lead into itself");
  return prisma.$transaction(async (tx) => {
    const [keep, drop] = await Promise.all([
      tx.lead.findUniqueOrThrow({ where: { id: keepId }, include: { enrichment: true } }),
      tx.lead.findUniqueOrThrow({ where: { id: dropId }, include: { enrichment: true, drafts: true } }),
    ]);
    const patch: Record<string, unknown> = {};
    for (const f of ["domain", "industry", "location", "employees", "foundedYear", "description"] as const) {
      if (keep[f] == null && drop[f] != null) patch[f] = drop[f];
    }
    // Free the unique domain before copying it to the survivor.
    if (patch.domain) await tx.lead.update({ where: { id: dropId }, data: { domain: null } });
    if (Object.keys(patch).length) await tx.lead.update({ where: { id: keepId }, data: patch });
    if (!keep.enrichment && drop.enrichment) {
      await tx.enrichment.update({ where: { leadId: dropId }, data: { leadId: keepId } });
    }
    for (const d of drop.drafts) {
      const clash = await tx.outreachDraft.findUnique({ where: { leadId_tone: { leadId: keepId, tone: d.tone } } });
      if (!clash) await tx.outreachDraft.update({ where: { id: d.id }, data: { leadId: keepId } });
    }
    await tx.mergeCandidate.deleteMany({ where: { OR: [{ leadAId: dropId }, { leadBId: dropId }] } });
    await tx.lead.delete({ where: { id: dropId } });
    await tx.counter.upsert({
      where: { key: "duplicatesRemoved" },
      update: { value: { increment: 1 } },
      create: { key: "duplicatesRemoved", value: 1 },
    });
    log.info({ keepId, dropId }, "leads merged");
    return keepId;
  });
}
