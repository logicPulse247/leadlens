import Fuse from "fuse.js";

export interface DedupeLead {
  id: string;
  name: string;
  domain: string | null;
  location?: string | null;
}

export interface CandidatePair {
  aId: string;
  bId: string;
  similarity: number;
  reason: "DOMAIN" | "FUZZY_NAME";
}

const LEGAL_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "co", "corp", "corporation", "ltd", "limited", "llp", "pllc", "pc", "lp", "company", "the",
]);

export function normalizeCompanyName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ");
  const tokens = base.split(/\s+/).filter((t) => t && !LEGAL_SUFFIXES.has(t));
  return tokens.join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 1 = identical after normalization, 0 = nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/** Extracts a US state code ("OH") from "Columbus, OH"; null if there isn't one. */
function stateOf(location?: string | null): string | null {
  if (!location) return null;
  const m = location.match(/\b([A-Z]{2})\b\s*$/);
  return m ? m[1] : null;
}

/** Two businesses with the same name in different states are different businesses. */
function locationsConflict(a?: string | null, b?: string | null): boolean {
  const sa = stateOf(a);
  const sb = stateOf(b);
  return !!sa && !!sb && sa !== sb;
}

export function normalizedDomainEquals(a: string | null, b: string | null): boolean {
  return !!a && !!b && a === b;
}

/**
 * Finds likely duplicate pairs among leads.
 * Pass 1: identical normalized domain (similarity 1).
 * Pass 2: fuzzy name match. Fuse.js narrows candidates per lead, Levenshtein similarity confirms.
 */
export function findMergeCandidates(leads: DedupeLead[], threshold = 0.85): CandidatePair[] {
  const pairs = new Map<string, CandidatePair>();
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const add = (a: DedupeLead, b: DedupeLead, similarity: number, reason: CandidatePair["reason"]) => {
    const k = key(a.id, b.id);
    const existing = pairs.get(k);
    if (existing && existing.similarity >= similarity) return;
    const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    pairs.set(k, { aId, bId, similarity: Math.round(similarity * 1000) / 1000, reason });
  };

  const byDomain = new Map<string, DedupeLead>();
  for (const l of leads) {
    if (!l.domain) continue;
    const prior = byDomain.get(l.domain);
    if (prior) add(prior, l, 1, "DOMAIN");
    else byDomain.set(l.domain, l);
  }

  const indexed = leads.map((l) => ({ lead: l, norm: normalizeCompanyName(l.name) })).filter((x) => x.norm.length >= 3);
  const fuse = new Fuse(indexed, { keys: ["norm"], threshold: 0.35, includeScore: true, ignoreLocation: true });

  for (const item of indexed) {
    const hits = fuse.search(item.norm, { limit: 6 });
    for (const hit of hits) {
      const other = hit.item;
      if (other.lead.id === item.lead.id) continue;
      if (normalizedDomainEquals(item.lead.domain, other.lead.domain)) continue;
      if (locationsConflict(item.lead.location, other.lead.location)) continue;
      const sim = nameSimilarity(item.lead.name, other.lead.name);
      if (sim >= threshold) add(item.lead, other.lead, sim, "FUZZY_NAME");
    }
  }

  return [...pairs.values()].sort((x, y) => y.similarity - x.similarity);
}
