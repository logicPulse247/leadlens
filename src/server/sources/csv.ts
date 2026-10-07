import Papa from "papaparse";
import { normalizeDomain } from "@/server/services/validation/domain";
import type { RawCompany } from "./LeadSource";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  name: ["name", "company", "companyname", "business", "businessname", "organization"],
  domain: ["domain", "website", "url", "site", "web", "companywebsite", "websiteurl"],
  industry: ["industry", "category", "sector", "vertical", "type"],
  location: ["location", "address", "region"],
  city: ["city", "town"],
  state: ["state", "province", "st"],
  employees: ["employees", "employeecount", "size", "headcount", "numemployees", "numberofemployees"],
  foundedYear: ["foundedyear", "founded", "yearfounded", "established", "yearestablished"],
  description: ["description", "about", "summary", "notes", "bio"],
  phone: ["phone", "telephone", "phonenumber", "tel"],
  email: ["email", "contactemail", "emailaddress"],
};

function buildHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const match = headers.find((h) => aliases.includes(norm(h)));
    if (match) map[field] = match;
  }
  return map;
}

/** "11-50" -> 31, "25" -> 25, "1,200" -> 1200. */
export function parseEmployees(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).replace(/,/g, "").trim();
  const range = s.match(/^(\d+)\s*[-–to]+\s*(\d+)$/);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2);
  const n = s.match(/\d+/);
  return n ? Number(n[0]) : null;
}

function parseYear(value: unknown): number | null {
  const m = String(value ?? "").match(/\b(1[89]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

export interface ParseResult {
  companies: RawCompany[];
  skipped: number;
  errors: string[];
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
  });
  const headers = parsed.meta.fields ?? [];
  const map = buildHeaderMap(headers);
  const errors: string[] = [];
  if (!map.name && !map.domain) {
    return { companies: [], skipped: parsed.data.length, errors: ["CSV needs a company name or website/domain column."] };
  }
  const companies: RawCompany[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const get = (f: string) => (map[f] ? clean(row[map[f]]) : null);
    const domain = get("domain");
    let name = get("name");
    if (!name && domain) name = normalizeDomain(domain);
    if (!name) {
      skipped++;
      continue;
    }
    const city = get("city");
    const state = get("state");
    const location = get("location") ?? ([city, state].filter(Boolean).join(", ") || null);
    companies.push({
      name,
      domain,
      industry: get("industry"),
      location,
      employees: parseEmployees(get("employees")),
      foundedYear: parseYear(get("foundedYear")),
      description: get("description"),
      phone: get("phone"),
      email: get("email"),
    });
  }
  for (const e of parsed.errors.slice(0, 3)) errors.push(`Row ${e.row ?? "?"}: ${e.message}`);
  return { companies, skipped, errors };
}

/**
 * Parses a pasted list. Accepted per line:
 *   "Acme Plumbing, acmeplumbing.com"  |  "Acme Plumbing - acmeplumbing.com"  |  "acmeplumbing.com"  |  "Acme Plumbing"
 */
export function parsePastedList(text: string): ParseResult {
  const companies: RawCompany[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[,\t|;]\s*|\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
    let name: string | null = null;
    let domain: string | null = null;
    for (const p of parts) {
      const d = normalizeDomain(p);
      if (d && !domain && /[./]/.test(p) && !/\s/.test(p)) domain = p;
      else if (!name) name = p;
    }
    if (!name && domain) name = normalizeDomain(domain);
    if (!name) {
      skipped++;
      continue;
    }
    companies.push({ name, domain });
  }
  return { companies, skipped, errors: [] };
}
