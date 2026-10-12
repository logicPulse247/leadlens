import { prisma } from "@/server/db/prisma";

export interface DashboardData {
  totals: { leads: number; scored: number; qualified: number; rejected: number; averageScore: number | null };
  tiers: { tier: "A" | "B" | "C" | "UNSCORED"; count: number }[];
  industries: { industry: string; averageScore: number; count: number }[];
  enrichment: { attempted: number; succeeded: number; blockedByRobots: number; failed: number; successRate: number | null; pending: number };
  duplicates: { removed: number; pendingReview: number };
  suppressions: number;
}

export async function getDashboard(icpId?: string): Promise<DashboardData> {
  const leadWhere = icpId ? { icpId } : {};
  const enrichWhere = icpId ? { lead: { icpId } } : {};

  const [total, tierGroups, industryGroups, status, avg, enriched, blocked, failed, counter, pendingMerges, suppressions, pendingEnrich] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.groupBy({ by: ["tier"], where: leadWhere, _count: true }),
    prisma.lead.groupBy({ by: ["industry"], where: { ...leadWhere, score: { not: null }, industry: { not: null } }, _avg: { score: true }, _count: true }),
    prisma.lead.groupBy({ by: ["status"], where: leadWhere, _count: true }),
    prisma.lead.aggregate({ where: { ...leadWhere, score: { not: null } }, _avg: { score: true } }),
    prisma.enrichment.count({ where: { ...enrichWhere, error: null, robotsAllowed: true } }),
    prisma.enrichment.count({ where: { ...enrichWhere, robotsAllowed: false } }),
    prisma.enrichment.count({ where: { ...enrichWhere, error: { not: null }, robotsAllowed: true } }),
    prisma.counter.findUnique({ where: { key: "duplicatesRemoved" } }),
    prisma.mergeCandidate.count({ where: { status: "PENDING" } }),
    prisma.suppression.count(),
    prisma.lead.count({ where: { ...leadWhere, enrichment: null } }),
  ]);

  const tierCounts = new Map(tierGroups.map((g) => [g.tier ?? "UNSCORED", g._count]));
  const statusCounts = new Map(status.map((s) => [s.status, s._count]));
  const attempted = enriched + blocked + failed;
  const scored = total - (tierCounts.get("UNSCORED") ?? 0);

  return {
    totals: {
      leads: total,
      scored,
      qualified: statusCounts.get("QUALIFIED") ?? 0,
      rejected: statusCounts.get("REJECTED") ?? 0,
      averageScore: avg._avg.score == null ? null : Math.round(avg._avg.score),
    },
    tiers: (["A", "B", "C", "UNSCORED"] as const).map((tier) => ({ tier, count: tierCounts.get(tier) ?? 0 })),
    industries: industryGroups
      .map((g) => ({ industry: g.industry as string, averageScore: Math.round(g._avg.score ?? 0), count: g._count }))
      .sort((a, b) => b.averageScore - a.averageScore || b.count - a.count),
    enrichment: {
      attempted,
      succeeded: enriched,
      blockedByRobots: blocked,
      failed,
      successRate: attempted ? Math.round((enriched / attempted) * 100) : null,
      pending: pendingEnrich,
    },
    duplicates: { removed: counter?.value ?? 0, pendingReview: pendingMerges },
    suppressions,
  };
}
