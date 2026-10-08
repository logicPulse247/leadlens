import { describe, expect, it } from "vitest";
import { blendScores } from "@/server/services/scoring/blend";
import { computeRuleScore, detectSignals, tierFor, WEIGHTS, type IcpCriteria, type LeadFacts } from "@/server/services/scoring/rules";
import { scoreResultSchema } from "@/server/services/scoring/schemas";
import { contentHash } from "@/server/services/llmCache";

const icp: IcpCriteria = {
  industries: ["HVAC", "Plumbing"],
  locations: ["OH", "Raleigh"],
  minEmployees: 10,
  maxEmployees: 60,
  includeKeywords: ["family-owned", "residential"],
  excludeKeywords: ["venture", "franchise"],
  signals: { ownerOperated: true, longEstablished: true, noRecentFunding: true, hiringSlowdown: false },
};

const ideal: LeadFacts = {
  name: "Tidewater Heating & Air",
  industry: "HVAC",
  location: "Columbus, OH",
  employees: 25,
  foundedYear: 1987,
  text: "Tidewater provides residential heating and cooling in Columbus, OH. Family-owned and operated for three generations. Serving customers since 1987.",
  techStack: [],
};

describe("rule-based scoring", () => {
  it("gives a perfect-fit company a top score and tier A", () => {
    const r = computeRuleScore(icp, ideal);
    expect(r.industry).toBe(WEIGHTS.industry);
    expect(r.size).toBe(WEIGHTS.size);
    expect(r.location).toBe(WEIGHTS.location);
    expect(r.total).toBeGreaterThanOrEqual(90);
    expect(tierFor(r.total)).toBe("A");
    expect(r.reasons.join(" ")).toMatch(/target industry/);
  });

  it("scores a mismatched company low and explains why", () => {
    const r = computeRuleScore(icp, { ...ideal, industry: "SaaS", location: "Austin, TX", employees: 400, text: "Venture-backed workflow software franchise." });
    expect(r.industry).toBe(0);
    expect(r.location).toBe(0);
    expect(r.size).toBe(0);
    expect(r.penalty).toBeGreaterThan(0);
    expect(tierFor(r.total)).toBe("C");
    expect(r.risks.join(" ")).toMatch(/outside the ICP/);
    expect(r.risks.join(" ")).toMatch(/excluded keyword/);
  });

  it("gives partial credit just outside the size range and for near-industry matches", () => {
    const near = computeRuleScore(icp, { ...ideal, employees: 8, industry: "HVAC Services" });
    expect(near.size).toBe(WEIGHTS.size * 0.5);
    expect(near.industry).toBeGreaterThan(0);
    expect(near.industry).toBeLessThan(WEIGHTS.industry);
  });

  it("treats unknown fields as a risk, not a zero or a crash", () => {
    const r = computeRuleScore(icp, { ...ideal, employees: null, industry: null, location: null, text: "" });
    expect(r.size).toBeGreaterThan(0);
    expect(r.risks.join(" ")).toMatch(/Employee count is unknown/);
    expect(r.risks.join(" ")).toMatch(/Location is unknown/);
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("matches two-letter states on word boundaries only", () => {
    const hit = computeRuleScore(icp, { ...ideal, location: "Dayton, OH" });
    const miss = computeRuleScore(icp, { ...ideal, location: "Toledo, OHIO-adjacent PA" });
    expect(hit.location).toBe(WEIGHTS.location);
    expect(miss.location).toBe(0);
  });

  it("uses neutral half-credit when the ICP leaves a dimension open", () => {
    const open: IcpCriteria = { ...icp, industries: [], locations: [], minEmployees: null, maxEmployees: null, includeKeywords: [], excludeKeywords: [], signals: { ownerOperated: false, longEstablished: false, noRecentFunding: false, hiringSlowdown: false } };
    const r = computeRuleScore(open, ideal);
    expect(r.industry).toBe(WEIGHTS.industry / 2);
    expect(r.location).toBe(WEIGHTS.location / 2);
    expect(r.signals).toBe(WEIGHTS.signals / 2);
  });

  it("never leaves the 0-100 range", () => {
    const worst = computeRuleScore({ ...icp, excludeKeywords: ["a", "venture", "franchise", "family"] }, { ...ideal, industry: "SaaS", location: "TX", employees: 900, text: "venture franchise family a" });
    expect(worst.total).toBeGreaterThanOrEqual(0);
    expect(worst.total).toBeLessThanOrEqual(100);
  });

  it.each([
    [74, "B"],
    [75, "A"],
    [50, "B"],
    [49, "C"],
  ])("maps score %i to tier %s", (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });
});

describe("signal detection", () => {
  it("finds owner-operation, longevity and absence of funding/hiring language", () => {
    const { signals, evidence } = detectSignals({ foundedYear: 1990, text: "A family-owned shop serving the area with reliable, honest work for many years." });
    expect(signals).toEqual({ ownerOperated: true, longEstablished: true, noRecentFunding: true, hiringSlowdown: true });
    expect(evidence.ownerOperated).toContain("family-owned");
  });

  it("flags funding and active hiring", () => {
    const { signals } = detectSignals({ foundedYear: 2018, text: "We closed a funding round led by a venture investor and are hiring across sales and engineering." });
    expect(signals.noRecentFunding).toBe(false);
    expect(signals.hiringSlowdown).toBe(false);
    expect(signals.longEstablished).toBe(false);
  });

  it("does not assert absence signals when there is almost no text", () => {
    const { signals } = detectSignals({ foundedYear: null, text: "Plumber" });
    expect(signals.noRecentFunding).toBe(false);
    expect(signals.hiringSlowdown).toBe(false);
  });

  it("reads 'since YYYY' from text when no founded year is known", () => {
    expect(detectSignals({ foundedYear: null, text: "Proudly serving customers since 1975 across the region and beyond." }).signals.longEstablished).toBe(true);
  });
});

describe("blending rules and the LLM", () => {
  const rules = computeRuleScore(icp, ideal);

  it("weights rules 60% and the LLM 40%", () => {
    const r = blendScores({ ...rules, total: 80 }, { score: 50, reasons: ["Seems owner run"], risks: [], acquisitionSignals: [] });
    expect(r.score).toBe(68);
    expect(r.tier).toBe("B");
  });

  it("derives the tier from the final score, ignoring anything the model claims", () => {
    const r = blendScores({ ...rules, total: 100 }, { score: 100, reasons: ["Great fit"], risks: [], acquisitionSignals: [] });
    expect(r.tier).toBe("A");
  });

  it("falls back to rules only, and says so, when the LLM is unavailable", () => {
    const r = blendScores(rules, null);
    expect(r.score).toBe(rules.total);
    expect(r.risks.join(" ")).toMatch(/AI assessment unavailable/);
  });

  it("dedupes reasons and always satisfies the public output schema", () => {
    const r = blendScores(rules, { score: 70, reasons: [rules.reasons[0], "x".repeat(400)], risks: [], acquisitionSignals: [] });
    expect(scoreResultSchema.safeParse(r).success).toBe(true);
    expect(r.reasons.filter((x) => x === rules.reasons[0])).toHaveLength(1);
    expect(r.reasons.every((x) => x.length <= 240)).toBe(true);
  });
});

describe("output schema", () => {
  it("rejects out-of-range scores, bad tiers and missing fields", () => {
    const ok = { score: 80, tier: "A", reasons: ["fits"], risks: [], acquisitionSignals: [] };
    expect(scoreResultSchema.safeParse(ok).success).toBe(true);
    expect(scoreResultSchema.safeParse({ ...ok, score: 101 }).success).toBe(false);
    expect(scoreResultSchema.safeParse({ ...ok, tier: "D" }).success).toBe(false);
    expect(scoreResultSchema.safeParse({ ...ok, score: 80.5 }).success).toBe(false);
    expect(scoreResultSchema.safeParse({ score: 80, tier: "A" }).success).toBe(false);
  });
});

describe("content hashing", () => {
  it("is independent of key order and changes with content", () => {
    expect(contentHash({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(contentHash({ b: { d: "x", c: [1, 2] }, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash({ a: 1, u: undefined })).toBe(contentHash({ a: 1 }));
  });
});
