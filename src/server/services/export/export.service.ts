import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { childLogger } from "@/lib/logger";
import type { LeadFilters } from "@/lib/schemas";
import type { EmailRecord, ScoreDetails } from "@/lib/types";
import { buildLeadWhere } from "../lead.service";
import { domainSuppressed, emailSuppressed, getSuppressionSets, type SuppressionSets } from "../suppression.service";
import { validateEmailSyntax } from "../validation/email";
import { toCsv } from "./csv";

const log = childLogger("export");

export const MAX_EXPORT_ROWS = 5000;

export type ExportFormat = "csv" | "json";

export interface ExportRow {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  employees: number | null;
  foundedYear: number | null;
  description: string | null;
  linkedin: string | null;
  facebook: string | null;
  twitter: string | null;
  primaryEmail: string | null;
  otherEmails: string[];
  phones: string[];
  score: number | null;
  tier: string | null;
  status: string;
  summary: string | null;
  reasons: string[];
  risks: string[];
  acquisitionSignals: string[];
  techStack: string[];
  sourceUrls: string[];
  enrichedAt: string | null;
}

export interface ExportResult {
  rows: ExportRow[];
  /** Leads dropped entirely because their domain is on the suppression list. */
  suppressedLeads: number;
  /** Individual email addresses removed from otherwise exportable leads. */
  suppressedEmails: number;
  /** True when more leads matched than MAX_EXPORT_ROWS. */
  truncated: boolean;
}

export function splitLocation(location: string | null): { city: string | null; state: string | null } {
  if (!location) return { city: null, state: null };
  const i = location.lastIndexOf(",");
  if (i === -1) return { city: location.trim() || null, state: null };
  return { city: location.slice(0, i).trim() || null, state: location.slice(i + 1).trim() || null };
}

const KIND_RANK: Record<EmailRecord["kind"], number> = { generic: 0, unknown: 1, personal: 2 };

/** Deliverable, non-suppressed emails ordered best-first (role addresses before personal ones). */
export function usableEmails(emails: EmailRecord[], fallback: string | null, sets: SuppressionSets): { usable: string[]; suppressed: number } {
  const candidates = emails
    .filter((e) => e.syntaxValid && e.mxValid !== false)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
    .map((e) => e.address);
  if (fallback && validateEmailSyntax(fallback.toLowerCase())) candidates.push(fallback.toLowerCase());

  const seen = new Set<string>();
  const usable: string[] = [];
  let suppressed = 0;
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (emailSuppressed(c, sets)) suppressed++;
    else usable.push(c);
  }
  return { usable, suppressed };
}

type LeadWithEnrichment = Prisma.LeadGetPayload<{ include: { enrichment: true } }>;

export function toExportRow(lead: LeadWithEnrichment, sets: SuppressionSets): { row: ExportRow; suppressedEmails: number } {
  const enrichment = lead.enrichment;
  const emails = (enrichment?.emails as unknown as EmailRecord[] | undefined) ?? [];
  const raw = (lead.rawData ?? {}) as { phone?: string | null; email?: string | null };
  const { usable, suppressed } = usableEmails(emails, raw.email ?? null, sets);
  const details = lead.scoreDetails as unknown as ScoreDetails | null;
  const socials = (enrichment?.socials ?? {}) as Record<string, string>;
  const phones = [...new Set([...(enrichment?.phones ?? []), ...(raw.phone ? [raw.phone] : [])])];
  const { city, state } = splitLocation(lead.location);

  return {
    suppressedEmails: suppressed,
    row: {
      id: lead.id,
      name: lead.name,
      domain: lead.domain,
      website: lead.domain ? `https://${lead.domain}` : null,
      phone: phones[0] ?? null,
      city,
      state,
      industry: lead.industry,
      employees: lead.employees,
      foundedYear: lead.foundedYear,
      description: lead.description,
      linkedin: socials.linkedin ?? null,
      facebook: socials.facebook ?? null,
      twitter: socials.twitter ?? null,
      primaryEmail: usable[0] ?? null,
      otherEmails: usable.slice(1),
      phones,
      score: lead.score,
      tier: lead.tier,
      status: lead.status,
      summary: details?.reasons?.[0] ?? null,
      reasons: details?.reasons ?? [],
      risks: details?.risks ?? [],
      acquisitionSignals: details?.acquisitionSignals ?? [],
      techStack: enrichment?.techStack ?? [],
      sourceUrls: enrichment?.sourceUrls ?? [],
      enrichedAt: enrichment?.fetchedAt.toISOString() ?? null,
    },
  };
}

export interface ExportSelection {
  ids?: string[];
  filters?: LeadFilters;
}

/**
 * Loads leads for export and enforces the opt-out list: suppressed domains are removed entirely and
 * suppressed email addresses are stripped from the contact columns. This is the single choke point
 * for every export format.
 */
export async function collectExport(selection: ExportSelection): Promise<ExportResult> {
  const where: Prisma.LeadWhereInput = selection.ids ? { id: { in: selection.ids } } : buildLeadWhere(selection.filters ?? {});
  const [leads, sets] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { enrichment: true },
      orderBy: [{ score: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      take: MAX_EXPORT_ROWS + 1,
    }),
    getSuppressionSets(),
  ]);

  const truncated = leads.length > MAX_EXPORT_ROWS;
  const rows: ExportRow[] = [];
  let suppressedLeads = 0;
  let suppressedEmails = 0;
  for (const lead of leads.slice(0, MAX_EXPORT_ROWS)) {
    if (domainSuppressed(lead.domain, sets)) {
      suppressedLeads++;
      continue;
    }
    const built = toExportRow(lead, sets);
    suppressedEmails += built.suppressedEmails;
    rows.push(built.row);
  }
  log.info({ exported: rows.length, suppressedLeads, suppressedEmails, truncated }, "export collected");
  return { rows, suppressedLeads, suppressedEmails, truncated };
}

/** Column names follow HubSpot's company import labels so the file maps automatically; LeadLens-specific fields use custom property names. */
export const HUBSPOT_COLUMNS: { header: string; value: (r: ExportRow) => unknown }[] = [
  { header: "Company name", value: (r) => r.name },
  { header: "Company Domain Name", value: (r) => r.domain },
  { header: "Website URL", value: (r) => r.website },
  { header: "Phone Number", value: (r) => r.phone },
  { header: "City", value: (r) => r.city },
  { header: "State/Region", value: (r) => r.state },
  { header: "Industry", value: (r) => r.industry },
  { header: "Number of Employees", value: (r) => r.employees },
  { header: "Year Founded", value: (r) => r.foundedYear },
  { header: "Description", value: (r) => r.description },
  { header: "LinkedIn Company Page", value: (r) => r.linkedin },
  { header: "Facebook Company Page", value: (r) => r.facebook },
  { header: "Twitter Handle", value: (r) => r.twitter },
  { header: "Primary Email", value: (r) => r.primaryEmail },
  { header: "Additional Emails", value: (r) => r.otherEmails.join("; ") },
  { header: "LeadLens Score", value: (r) => r.score },
  { header: "LeadLens Tier", value: (r) => r.tier },
  { header: "LeadLens Status", value: (r) => r.status },
  { header: "LeadLens Why", value: (r) => r.reasons.join(" | ") },
  { header: "LeadLens Risks", value: (r) => r.risks.join(" | ") },
  { header: "LeadLens Acquisition Signals", value: (r) => r.acquisitionSignals.join(" | ") },
];

export function renderCsv(rows: ExportRow[]): string {
  return toCsv(HUBSPOT_COLUMNS, rows);
}

export function renderJson(rows: ExportRow[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, leads: rows }, null, 2);
}
