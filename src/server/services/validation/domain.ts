const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/** Reserved TLDs (RFC 2606 / 6761): never resolvable on the public internet, so we never fetch them. */
const RESERVED_TLDS = new Set(["example", "test", "invalid", "localhost"]);

/**
 * Normalizes a URL, hostname or email address to a bare lowercase registrable-looking domain:
 * strips protocol, credentials, "www.", port, path, query and trailing dots.
 * Returns null if the result is not a plausible domain.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, "");
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^www\d*\./, "");
  s = s.replace(/\.+$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}

export function isReservedDomain(domain: string): boolean {
  const tld = domain.split(".").pop() ?? "";
  return RESERVED_TLDS.has(tld);
}

/** Domains of free webmail providers are never a company's own website. */
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "proton.me", "protonmail.com"]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain);
}
