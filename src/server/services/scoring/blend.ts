import { scoreResultSchema, type CachedAssessment, type ScoreResult } from "./schemas";
import { tierFor, type RuleScore } from "./rules";

export const RULE_WEIGHT = 0.6;
export const LLM_WEIGHT = 0.4;

const clip = (s: string) => (s.length > 240 ? `${s.slice(0, 237)}...` : s);

function merge(primary: string[], secondary: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...primary, ...secondary]) {
    const key = line.toLowerCase();
    if (line.trim().length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(clip(line));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Blends deterministic rules (60%) with the LLM's read of the about-text (40%).
 * The tier is always derived from the final score here, never trusted from the model.
 * The result is validated against the public output schema before it leaves this function.
 */
export function blendScores(rules: RuleScore, llm: CachedAssessment | null): ScoreResult {
  const score = llm ? Math.round(RULE_WEIGHT * rules.total + LLM_WEIGHT * llm.score) : rules.total;
  const risks = llm ? merge(rules.risks, llm.risks, 5) : merge(rules.risks, ["AI assessment unavailable, so this score uses the rules only"], 5);
  return scoreResultSchema.parse({
    score,
    tier: tierFor(score),
    reasons: merge(rules.reasons, llm?.reasons ?? [], 5),
    risks,
    acquisitionSignals: merge(rules.acquisitionSignals, llm?.acquisitionSignals ?? [], 6),
  });
}
