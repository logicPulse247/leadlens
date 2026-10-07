import type { LeadSourceType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { childLogger } from "@/lib/logger";
import type { RawCompany } from "@/server/sources/LeadSource";
import { normalizeDomain } from "./validation/domain";
import { normalizeCompanyName } from "./dedupe/match";
import { bumpDuplicatesRemoved, refreshMergeCandidates } from "./dedupe/dedupe.service";

const log = childLogger("import");

export interface ImportSummary {
  received: number;
  created: number;
  /** Rows dropped because the same normalized domain was already in the batch or the database. */
  duplicatesRemoved: number;
  invalidDomains: number;
  skipped: number;
  fuzzyCandidates: number;
  createdIds: string[];
}

interface Prepared {
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  employees: number | null;
  foundedYear: number | null;
  description: string | null;
  rawData: Prisma.InputJsonValue;
}

const trunc = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

function prepare(raw: RawCompany, counters: { invalidDomains: number }): Prepared | null {
  const name = trunc(raw.name, 200);
  if (!name) return null;
  const domain = normalizeDomain(raw.domain);
  if (raw.domain && !domain) counters.invalidDomains++;
  return {
    name,
    domain,
    industry: trunc(raw.industry, 100),
    location: trunc(raw.location, 120),
    employees: raw.employees != null && Number.isFinite(raw.employees) && raw.employees >= 0 ? Math.round(raw.employees) : null,
    foundedYear: raw.foundedYear && raw.foundedYear > 1700 && raw.foundedYear <= new Date().getFullYear() ? raw.foundedYear : null,
    description: trunc(raw.description, 4000),
    rawData: { phone: raw.phone ?? null, email: raw.email ?? null },
  };
}

const richness = (p: Prepared) =>
  [p.industry, p.location, p.employees, p.foundedYear, p.description].filter((v) => v != null).length;

/**
 * Cleans, deduplicates (by normalized domain, then exact normalized name for domainless rows)
 * and persists companies from any source. Existing leads are enriched with any missing fields.
 */
export async function importCompanies(
  raw: RawCompany[],
  opts: { source: LeadSourceType; icpId?: string | null },
): Promise<ImportSummary> {
  const counters = { invalidDomains: 0 };
  let skipped = 0;
  let duplicatesRemoved = 0;

  const batch = new Map<string, Prepared>();
  for (const r of raw) {
    const p = prepare(r, counters);
    if (!p) {
      skipped++;
      continue;
    }
    const key = p.domain ? `d:${p.domain}` : `n:${normalizeCompanyName(p.name)}`;
    const prior = batch.get(key);
    if (prior) {
      duplicatesRemoved++;
      if (richness(p) > richness(prior)) batch.set(key, p);
    } else {
      batch.set(key, p);
    }
  }

  const prepared = [...batch.values()];
  const domains = prepared.map((p) => p.domain).filter((d): d is string => !!d);
  const existing = await prisma.lead.findMany({ where: { domain: { in: domains } } });
  const existingByDomain = new Map(existing.map((e) => [e.domain!, e]));

  const toCreate: Prepared[] = [];
  for (const p of prepared) {
    const found = p.domain ? existingByDomain.get(p.domain) : undefined;
    if (!found) {
      toCreate.push(p);
      continue;
    }
    duplicatesRemoved++;
    const patch: Prisma.LeadUpdateInput = {};
    if (!found.industry && p.industry) patch.industry = p.industry;
    if (!found.location && p.location) patch.location = p.location;
    if (found.employees == null && p.employees != null) patch.employees = p.employees;
    if (found.foundedYear == null && p.foundedYear != null) patch.foundedYear = p.foundedYear;
    if (!found.description && p.description) patch.description = p.description;
    if (Object.keys(patch).length) await prisma.lead.update({ where: { id: found.id }, data: patch });
  }

  const created = toCreate.length
    ? await prisma.lead.createManyAndReturn({
        data: toCreate.map((p) => ({ ...p, source: opts.source, icpId: opts.icpId ?? null })),
        select: { id: true },
        skipDuplicates: true,
      })
    : [];

  await bumpDuplicatesRemoved(duplicatesRemoved);
  const fuzzyCandidates = created.length ? await refreshMergeCandidates() : 0;

  const summary: ImportSummary = {
    received: raw.length,
    created: created.length,
    duplicatesRemoved,
    invalidDomains: counters.invalidDomains,
    skipped,
    fuzzyCandidates,
    createdIds: created.map((c) => c.id),
  };
  log.info({ ...summary, createdIds: undefined, source: opts.source }, "import complete");
  return summary;
}
