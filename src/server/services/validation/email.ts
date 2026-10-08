import dns from "node:dns/promises";
import type { EmailRecord } from "@/lib/types";
import { cacheGet, cacheSet } from "@/server/cache/cache";
import { isReservedDomain } from "./domain";

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i;

export function normalizeEmail(input: string): string {
  return input.trim().replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
}

export function validateEmailSyntax(email: string): boolean {
  if (email.length > 254) return false;
  if (!EMAIL_RE.test(email)) return false;
  const [local] = email.split("@");
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

const GENERIC_LOCALS = new Set([
  "info", "contact", "hello", "hi", "office", "sales", "support", "service", "services", "admin", "team", "mail",
  "enquiries", "inquiries", "billing", "accounts", "reception", "help", "bookings", "appointments", "orders", "quotes", "estimates",
]);

/**
 * "generic" role mailboxes are the safest business contacts; anything that looks like a
 * person's name (first.last@, jsmith@) is flagged "personal" so users can treat it carefully.
 */
export function classifyEmail(address: string): EmailRecord["kind"] {
  const local = address.split("@")[0] ?? "";
  if (GENERIC_LOCALS.has(local)) return "generic";
  if (/^[a-z]{2,}([._-][a-z]{2,})+$/.test(local) || /^[a-z]\.?[a-z]{3,}$/.test(local)) return "personal";
  return "unknown";
}

/** true = has mail servers, false = domain definitively cannot receive mail, null = could not determine. */
export type MxResolver = (domain: string) => Promise<boolean | null>;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("dns timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const dnsMxResolver: MxResolver = async (domain) => {
  if (isReservedDomain(domain)) return null;
  const key = `mx:${domain}`;
  const cached = await cacheGet<{ v: boolean | null }>(key);
  if (cached) return cached.v;

  let result: boolean | null;
  try {
    const records = await withTimeout(dns.resolveMx(domain), 4000);
    result = records.length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      // RFC 5321: a domain with an A record and no MX implicitly accepts mail.
      try {
        const a = await withTimeout(dns.resolve4(domain), 4000);
        result = a.length > 0;
      } catch (err2) {
        const c2 = (err2 as NodeJS.ErrnoException).code;
        result = c2 === "ENOTFOUND" || c2 === "ENODATA" ? false : null;
      }
    } else {
      result = null;
    }
  }
  // Only cache definitive answers for long; unknowns expire quickly.
  await cacheSet(key, { v: result }, result === null ? 300 : 24 * 3600);
  return result;
};

export async function validateEmail(raw: string, resolver: MxResolver = dnsMxResolver, sourceUrl?: string): Promise<EmailRecord | null> {
  const address = normalizeEmail(raw);
  if (!address) return null;
  const syntaxValid = validateEmailSyntax(address);
  const mxValid = syntaxValid ? await resolver(address.split("@")[1]) : false;
  return { address, syntaxValid, mxValid, kind: classifyEmail(address), ...(sourceUrl ? { sourceUrl } : {}) };
}
