import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { LeadFilters, LeadListQuery } from "@/lib/schemas";

export function buildLeadWhere(f: LeadFilters): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];
  if (f.q) {
    and.push({
      OR: [
        { name: { contains: f.q, mode: "insensitive" } },
        { domain: { contains: f.q, mode: "insensitive" } },
        { industry: { contains: f.q, mode: "insensitive" } },
        { location: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.status) and.push({ status: f.status });
  if (f.tier) and.push({ tier: f.tier });
  if (f.industry) and.push({ industry: f.industry });
  if (f.icpId) and.push({ icpId: f.icpId });
  if (f.minScore != null || f.maxScore != null) {
    and.push({ score: { gte: f.minScore ?? undefined, lte: f.maxScore ?? undefined } });
  }
  return and.length ? { AND: and } : {};
}

export const leadListSelect = {
  id: true,
  name: true,
  domain: true,
  industry: true,
  location: true,
  employees: true,
  status: true,
  score: true,
  tier: true,
  icpId: true,
  createdAt: true,
  updatedAt: true,
  enrichment: { select: { fetchedAt: true, error: true, emails: true, phones: true } },
} satisfies Prisma.LeadSelect;

export async function listLeads(q: LeadListQuery) {
  const where = buildLeadWhere(q);
  // Unscored leads sort last regardless of direction.
  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    q.sort === "score" || q.sort === "tier"
      ? [{ [q.sort]: { sort: q.order, nulls: "last" } }, { name: "asc" }]
      : [{ [q.sort]: q.order }, { id: "asc" }];

  const [items, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: leadListSelect }),
    prisma.lead.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function getLeadDetail(id: string) {
  return prisma.lead.findUniqueOrThrow({
    where: { id },
    include: {
      enrichment: true,
      drafts: { orderBy: { updatedAt: "desc" } },
      icp: { select: { id: true, name: true } },
    },
  });
}

export async function leadFacets() {
  const [industries, statuses] = await Promise.all([
    prisma.lead.groupBy({ by: ["industry"], where: { industry: { not: null } }, _count: true, orderBy: { industry: "asc" } }),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
  ]);
  return {
    industries: industries.map((i) => ({ value: i.industry as string, count: i._count })),
    statuses: Object.fromEntries(statuses.map((s) => [s.status, s._count])),
  };
}

export async function setLeadStatus(ids: string[], status: "QUALIFIED" | "REJECTED" | "NEW") {
  const res = await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status } });
  return res.count;
}

export async function deleteLeads(ids: string[]) {
  const res = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  return res.count;
}
