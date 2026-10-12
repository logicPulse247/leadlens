import { describe, expect, it, vi } from "vitest";
import { escapeCell, neutraliseFormula, toCsv } from "@/server/services/export/csv";

vi.mock("@/server/db/prisma", () => ({ prisma: {} }));

import { HUBSPOT_COLUMNS, renderCsv, splitLocation, toExportRow, usableEmails } from "@/server/services/export/export.service";
import type { SuppressionSets } from "@/server/services/suppression.service";

const sets = (domains: string[] = [], emails: string[] = []): SuppressionSets => ({ domains: new Set(domains), emails: new Set(emails) });

const email = (address: string, extra: Partial<{ kind: "generic" | "personal" | "unknown"; mxValid: boolean | null; syntaxValid: boolean }> = {}) => ({
  address,
  syntaxValid: true,
  mxValid: true as boolean | null,
  kind: "generic" as const,
  ...extra,
});

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: "l1",
    name: "Tidewater Heating & Air",
    domain: "tidewater.example",
    industry: "HVAC",
    location: "Columbus, OH",
    employees: 25,
    foundedYear: 1987,
    description: "Family-owned HVAC.",
    source: "SEED",
    status: "ENRICHED",
    icpId: null,
    score: 82,
    tier: "A",
    scoreDetails: { score: 82, tier: "A", reasons: ["Target industry: HVAC"], risks: ["Few online reviews"], acquisitionSignals: ["Family-owned"] },
    scoreHash: null,
    rawData: { phone: null, email: null },
    mergedIntoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    enrichment: {
      id: "e1",
      leadId: "l1",
      emails: [email("info@tidewater.example"), email("jane@tidewater.example", { kind: "personal" })],
      phones: ["+16145550123"],
      socials: { linkedin: "https://linkedin.com/company/tidewater" },
      about: null,
      techStack: ["WordPress"],
      sourceUrls: ["https://tidewater.example/about"],
      robotsAllowed: true,
      error: null,
      fetchedAt: new Date("2026-10-01T00:00:00Z"),
      expiresAt: new Date("2026-10-08T00:00:00Z"),
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("csv escaping", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(escapeCell('Smith, "Bob" & Sons')).toBe('"Smith, ""Bob"" & Sons"');
    expect(escapeCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(0)).toBe("0");
  });

  it("defuses spreadsheet formulas but not phone numbers", () => {
    expect(neutraliseFormula("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(neutraliseFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliseFormula("+cmd|' /C calc'!A0")).toMatch(/^'/);
    expect(neutraliseFormula("+1 (614) 555-0123")).toBe("+1 (614) 555-0123");
    expect(neutraliseFormula("+16145550123")).toBe("+16145550123");
    expect(neutraliseFormula("-5")).toBe("-5");
    expect(neutraliseFormula("Plain text")).toBe("Plain text");
  });

  it("emits a BOM, CRLF rows and a header", () => {
    const out = toCsv([{ header: "A", value: (r: { a: string }) => r.a }], [{ a: "x" }, { a: "y,z" }]);
    expect(out).toBe('\uFEFFA\r\nx\r\n"y,z"\r\n');
  });
});

describe("location splitting", () => {
  it.each([
    ["Columbus, OH", "Columbus", "OH"],
    ["St. Paul, Minnesota", "St. Paul", "Minnesota"],
    ["Raleigh", "Raleigh", null],
    [null, null, null],
  ])("%s", (loc, city, state) => {
    expect(splitLocation(loc)).toEqual({ city, state });
  });
});

describe("email selection and suppression", () => {
  it("prefers generic role addresses, drops undeliverable ones, and falls back to the imported email", () => {
    const r = usableEmails([email("jane@x.example", { kind: "personal" }), email("info@x.example"), email("dead@x.example", { mxValid: false }), email("bad", { syntaxValid: false })], "Owner@X.example", sets());
    expect(r.usable).toEqual(["info@x.example", "jane@x.example", "owner@x.example"]);
  });

  it("removes suppressed addresses and addresses on suppressed domains", () => {
    const r = usableEmails([email("info@x.example"), email("jane@x.example", { kind: "personal" }), email("sales@other.example")], null, sets(["other.example"], ["info@x.example"]));
    expect(r.usable).toEqual(["jane@x.example"]);
    expect(r.suppressed).toBe(2);
  });

  it("de-duplicates the same address", () => {
    expect(usableEmails([email("info@x.example"), email("INFO@x.example".toLowerCase())], "info@x.example", sets()).usable).toEqual(["info@x.example"]);
  });
});

describe("export rows", () => {
  it("maps a lead into HubSpot-style columns", () => {
    const { row } = toExportRow(lead(), sets());
    expect(row).toMatchObject({ city: "Columbus", state: "OH", website: "https://tidewater.example", primaryEmail: "info@tidewater.example", phone: "+16145550123", score: 82, tier: "A" });
    expect(row.linkedin).toContain("linkedin.com");

    const csv = renderCsv([row]);
    const [header, line] = csv.replace("\uFEFF", "").split("\r\n");
    expect(header.split(",")).toEqual(HUBSPOT_COLUMNS.map((c) => c.header));
    expect(line).toContain("Tidewater Heating & Air");
    expect(line).toContain("info@tidewater.example");
    expect(line).toContain("Target industry: HVAC");
  });

  it("strips suppressed emails from contact columns but keeps the company", () => {
    const { row, suppressedEmails } = toExportRow(lead(), sets([], ["info@tidewater.example"]));
    expect(suppressedEmails).toBe(1);
    expect(row.primaryEmail).toBe("jane@tidewater.example");
    expect(JSON.stringify(row)).not.toContain("info@tidewater.example");
  });

  it("copes with a lead that was never enriched or scored", () => {
    const { row } = toExportRow(lead({ enrichment: null, score: null, tier: null, scoreDetails: null, location: null, rawData: { email: "hello@tidewater.example", phone: "+16145550000" } }), sets());
    expect(row.primaryEmail).toBe("hello@tidewater.example");
    expect(row.phone).toBe("+16145550000");
    expect(row.reasons).toEqual([]);
    expect(row.city).toBeNull();
  });
});
