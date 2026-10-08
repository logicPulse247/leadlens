import { prisma } from "@/server/db/prisma";
import { normalizeDomain } from "./validation/domain";
import { normalizeEmail, validateEmailSyntax } from "./validation/email";

export interface SuppressionSets {
  domains: Set<string>;
  emails: Set<string>;
}

export async function getSuppressionSets(): Promise<SuppressionSets> {
  const rows = await prisma.suppression.findMany({ select: { type: true, value: true } });
  return {
    domains: new Set(rows.filter((r) => r.type === "DOMAIN").map((r) => r.value)),
    emails: new Set(rows.filter((r) => r.type === "EMAIL").map((r) => r.value)),
  };
}

/** A domain is suppressed if it, or any parent domain, is on the list (opting out example.com covers mail.example.com). */
export function domainSuppressed(domain: string | null | undefined, sets: SuppressionSets): boolean {
  if (!domain) return false;
  const parts = domain.toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (sets.domains.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export function emailSuppressed(email: string, sets: SuppressionSets): boolean {
  const e = normalizeEmail(email);
  return sets.emails.has(e) || domainSuppressed(e.split("@")[1], sets);
}

export async function isDomainSuppressed(domain: string | null | undefined): Promise<boolean> {
  return domainSuppressed(domain, await getSuppressionSets());
}

export type ParsedSuppression = { type: "DOMAIN" | "EMAIL"; value: string };

/** Accepts an email address, a domain, or a URL. Returns null for anything unusable. */
export function parseSuppressionInput(input: string): ParsedSuppression | null {
  const v = input.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("@") && !v.startsWith("@") && !v.includes("/")) {
    const email = normalizeEmail(v);
    return validateEmailSyntax(email) ? { type: "EMAIL", value: email } : null;
  }
  const domain = normalizeDomain(v.replace(/^@/, ""));
  return domain ? { type: "DOMAIN", value: domain } : null;
}

export async function listSuppressions() {
  return prisma.suppression.findMany({ orderBy: { createdAt: "desc" } });
}

export async function addSuppressions(inputs: string[], reason?: string) {
  const parsed = inputs.map(parseSuppressionInput);
  const valid = parsed.filter((p): p is ParsedSuppression => !!p);
  const invalid = inputs.filter((_, i) => !parsed[i]);
  const res = valid.length
    ? await prisma.suppression.createMany({ data: valid.map((p) => ({ ...p, reason: reason ?? null })), skipDuplicates: true })
    : { count: 0 };
  return { added: res.count, invalid };
}

export async function removeSuppression(id: string) {
  await prisma.suppression.delete({ where: { id } });
}
