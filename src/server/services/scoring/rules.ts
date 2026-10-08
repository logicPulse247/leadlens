import type { Signals } from "@/lib/schemas";

export interface IcpCriteria {
  industries: string[];
  locations: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  signals: Signals;
}

export interface LeadFacts {
  name: string;
  industry: string | null;
  location: string | null;
  employees: number | null;
  foundedYear: number | null;
  /** Descriptive text from the CSV and the company's own website. */
  text: string;
  techStack: string[];
}

export const WEIGHTS = { industry: 30, size: 25, location: 15, keywords: 15, signals: 15 } as const;
export const TIER_THRESHOLDS = { A: 75, B: 50 } as const;

export function tierFor(score: number): "A" | "B" | "C" {
  return score >= TIER_THRESHOLDS.A ? "A" : score >= TIER_THRESHOLDS.B ? "B" : "C";
}

export interface DetectedSignals {
  ownerOperated: boolean;
  longEstablished: boolean;
  noRecentFunding: boolean;
  hiringSlowdown: boolean;
}

const OWNER_RE = /family[- ]owned|owner[- ]operated|locally owned|owner is (?:on|in)|founded and (?:still )?run|led day to day by|(?:two|three|second|third|fourth)[- ]generations?|generations? of|the founder/i;
const FUNDING_RE = /venture|series [a-d]\b|funding round|raised \$|private equity|backed by|roll-?up|investor/i;
const HIRING_RE = /\bhiring\b|join our team|open positions|we(?:'|’)re growing|careers|now hiring/i;
const NO_HIRING_RE = /no open positions|not currently hiring|same size for years|stayed the same size/i;

const CURRENT_YEAR = new Date().getFullYear();

/** Detects acquisition signals purely from text and dates, so every claim is traceable to the source. */
export function detectSignals(f: Pick<LeadFacts, "text" | "foundedYear">): { signals: DetectedSignals; evidence: Record<keyof DetectedSignals, string | null> } {
  const text = f.text;
  const evidence: Record<keyof DetectedSignals, string | null> = { ownerOperated: null, longEstablished: null, noRecentFunding: null, hiringSlowdown: null };

  const owner = text.match(OWNER_RE);
  if (owner) evidence.ownerOperated = `"${owner[0]}"`;

  const sinceMatch = text.match(/since\s+((?:19|20)\d\d)/i);
  const yearsMatch = text.match(/(\d{2,3})\+?\s+years/i);
  const founded = f.foundedYear ?? (sinceMatch ? Number(sinceMatch[1]) : null);
  if (founded && CURRENT_YEAR - founded >= 15) evidence.longEstablished = `in business since ${founded} (${CURRENT_YEAR - founded} years)`;
  else if (yearsMatch && Number(yearsMatch[1]) >= 15) evidence.longEstablished = `"${yearsMatch[0]}" of experience`;

  if (text.trim().length >= 40 && !FUNDING_RE.test(text)) evidence.noRecentFunding = "no venture, PE or funding language found";

  if (text.trim().length >= 40) {
    if (NO_HIRING_RE.test(text)) evidence.hiringSlowdown = `"${text.match(NO_HIRING_RE)![0]}"`;
    else if (!HIRING_RE.test(text)) evidence.hiringSlowdown = "no hiring language found";
  }

  return {
    signals: {
      ownerOperated: !!evidence.ownerOperated,
      longEstablished: !!evidence.longEstablished,
      noRecentFunding: !!evidence.noRecentFunding,
      hiringSlowdown: !!evidence.hiringSlowdown,
    },
    evidence,
  };
}

export const SIGNAL_PHRASES: Record<keyof DetectedSignals, string> = {
  ownerOperated: "Owner-operated",
  longEstablished: "Long-established",
  noRecentFunding: "No recent funding",
  hiringSlowdown: "Hiring slowdown",
};

export interface RuleScore {
  industry: number;
  size: number;
  location: number;
  keywords: number;
  signals: number;
  penalty: number;
  total: number;
  reasons: string[];
  risks: string[];
  acquisitionSignals: string[];
}

const lc = (s: string) => s.toLowerCase();

function industryScore(icp: IcpCriteria, f: LeadFacts, reasons: string[], risks: string[]): number {
  const w = WEIGHTS.industry;
  if (!icp.industries.length) return w / 2;
  if (!f.industry) {
    risks.push("Industry is unknown, so ICP industry fit can't be confirmed");
    return w * 0.3;
  }
  const industry = lc(f.industry);
  const wanted = icp.industries.map(lc);
  if (wanted.includes(industry)) {
    reasons.push(`Industry "${f.industry}" is a target industry`);
    return w;
  }
  if (wanted.some((i) => industry.includes(i) || i.includes(industry))) {
    reasons.push(`Industry "${f.industry}" is close to a target industry`);
    return w * 0.65;
  }
  risks.push(`Industry "${f.industry}" is outside the ICP (${icp.industries.slice(0, 3).join(", ")}${icp.industries.length > 3 ? "…" : ""})`);
  return 0;
}

function sizeScore(icp: IcpCriteria, f: LeadFacts, reasons: string[], risks: string[]): number {
  const w = WEIGHTS.size;
  const { minEmployees: min, maxEmployees: max } = icp;
  if (min == null && max == null) return w * 0.6;
  if (f.employees == null) {
    risks.push("Employee count is unknown");
    return w * 0.3;
  }
  const n = f.employees;
  const lo = min ?? 0;
  const hi = max ?? Infinity;
  if (n >= lo && n <= hi) {
    reasons.push(`${n} employees fits the ${min ?? 0}–${max ?? "∞"} target range`);
    return w;
  }
  const gap = n < lo ? (lo - n) / Math.max(lo, 1) : (n - hi) / Math.max(hi, 1);
  if (gap <= 0.25) {
    risks.push(`${n} employees is just outside the ${min ?? 0}–${max ?? "∞"} target range`);
    return w * 0.5;
  }
  risks.push(`${n} employees is well ${n < lo ? "below" : "above"} the target range`);
  return 0;
}

function stateCode(token: string): boolean {
  return /^[A-Za-z]{2}$/.test(token);
}

function locationScore(icp: IcpCriteria, f: LeadFacts, reasons: string[], risks: string[]): number {
  const w = WEIGHTS.location;
  if (!icp.locations.length) return w / 2;
  if (!f.location) {
    risks.push("Location is unknown");
    return w * 0.3;
  }
  const loc = f.location;
  const hit = icp.locations.find((l) => {
    const needle = l.trim();
    if (!needle) return false;
    if (stateCode(needle)) return new RegExp(`\\b${needle}\\b`, "i").test(loc.replace(/,/g, " "));
    return lc(loc).includes(lc(needle));
  });
  if (hit) {
    reasons.push(`Located in a target area (${loc})`);
    return w;
  }
  risks.push(`Location "${loc}" is outside the target areas`);
  return 0;
}

function keywordScore(icp: IcpCriteria, f: LeadFacts, reasons: string[], risks: string[]): { score: number; penalty: number } {
  const w = WEIGHTS.keywords;
  const haystack = lc(`${f.name} ${f.industry ?? ""} ${f.text}`);
  const excluded = icp.excludeKeywords.filter((k) => k.trim() && haystack.includes(lc(k)));
  let penalty = 0;
  if (excluded.length) {
    penalty = Math.min(25, 15 + (excluded.length - 1) * 5);
    risks.push(`Mentions excluded keyword${excluded.length > 1 ? "s" : ""}: ${excluded.join(", ")}`);
  }
  const include = icp.includeKeywords.filter((k) => k.trim());
  if (!include.length) return { score: w / 2, penalty };
  const hits = include.filter((k) => haystack.includes(lc(k)));
  if (hits.length) reasons.push(`Mentions target keyword${hits.length > 1 ? "s" : ""}: ${hits.join(", ")}`);
  else risks.push("None of the target keywords appear in the company's description");
  return { score: w * (hits.length / include.length), penalty };
}

export function computeRuleScore(icp: IcpCriteria, f: LeadFacts): RuleScore {
  const reasons: string[] = [];
  const risks: string[] = [];

  const industry = industryScore(icp, f, reasons, risks);
  const size = sizeScore(icp, f, reasons, risks);
  const location = locationScore(icp, f, reasons, risks);
  const { score: keywords, penalty } = keywordScore(icp, f, reasons, risks);

  const { signals: detected, evidence } = detectSignals(f);
  const wanted = (Object.keys(icp.signals) as (keyof Signals)[]).filter((k) => icp.signals[k]);
  let signals: number;
  if (!wanted.length) signals = WEIGHTS.signals / 2;
  else {
    const present = wanted.filter((k) => detected[k]);
    signals = WEIGHTS.signals * (present.length / wanted.length);
    for (const k of wanted) {
      if (!detected[k]) {
        if (k === "noRecentFunding") risks.push("Text suggests outside funding or investor backing");
        else if (k === "hiringSlowdown") risks.push("Active hiring suggests the business is still in growth mode");
        else if (evidence[k] === null && f.text.trim().length < 40) risks.push(`Not enough description to confirm "${SIGNAL_PHRASES[k]}"`);
        else risks.push(`No evidence of "${SIGNAL_PHRASES[k]}"`);
      }
    }
  }
  const acquisitionSignals = (Object.keys(detected) as (keyof DetectedSignals)[])
    .filter((k) => detected[k])
    .map((k) => `${SIGNAL_PHRASES[k]}: ${evidence[k]}`);

  const raw = industry + size + location + keywords + signals - penalty;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    industry: round(industry),
    size: round(size),
    location: round(location),
    keywords: round(keywords),
    signals: round(signals),
    penalty,
    total: Math.max(0, Math.min(100, Math.round(raw))),
    reasons,
    risks,
    acquisitionSignals,
  };
}
