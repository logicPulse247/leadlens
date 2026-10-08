import { detectSignals, SIGNAL_PHRASES, type IcpCriteria } from "@/server/services/scoring/rules";
import type { Fact } from "@/server/services/outreach/facts";
import { renderTemplate, type Sender, type Tone } from "@/server/services/outreach/templates";
import type { CompletionRequest, LLMProvider } from "./provider";

interface ScoreInput {
  icp: IcpCriteria;
  leads: { id: string; name: string; industry: string | null; employees: number | null; foundedYear: number | null; text: string }[];
}
interface OutreachInput {
  facts: Fact[];
  tone: Tone;
  sender: Sender;
}

const FUNDING_RE = /venture|series [a-d]\b|funding round|raised \$|private equity|backed by|roll-?up|investor/i;
const HIRING_RE = /\bhiring\b|join our team|open positions|we(?:'|’)re growing|now hiring/i;

function assess(icp: IcpCriteria, lead: ScoreInput["leads"][number]) {
  const text = lead.text;
  const { signals, evidence } = detectSignals({ text, foundedYear: lead.foundedYear });
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 40;

  if (signals.ownerOperated) {
    score += 18;
    reasons.push(`Website language points to founder or family ownership (${evidence.ownerOperated})`);
  }
  if (signals.longEstablished) {
    score += 10;
    reasons.push(`Long operating history: ${evidence.longEstablished}`);
  }
  if (FUNDING_RE.test(text)) {
    score -= 25;
    risks.push("Website text mentions outside investment, which makes a founder-led acquisition less likely");
  } else if (text.length >= 40) {
    score += 6;
  }
  if (HIRING_RE.test(text)) {
    score -= 6;
    risks.push("The company advertises open roles, which suggests it is still in growth mode");
  } else if (signals.hiringSlowdown) {
    score += 4;
  }
  const hay = `${lead.name} ${lead.industry ?? ""} ${text}`.toLowerCase();
  const hits = icp.includeKeywords.filter((k) => k && hay.includes(k.toLowerCase()));
  if (hits.length) {
    score += Math.min(12, hits.length * 4);
    reasons.push(`Description matches the ICP keywords: ${hits.join(", ")}`);
  }
  const bad = icp.excludeKeywords.filter((k) => k && hay.includes(k.toLowerCase()));
  if (bad.length) {
    score -= 15;
    risks.push(`Text includes excluded terms: ${bad.join(", ")}`);
  }
  if (lead.industry && icp.industries.some((i) => i.toLowerCase() === lead.industry!.toLowerCase())) score += 8;
  if (text.length < 40) risks.push("Very little descriptive text was available to assess");

  const acquisitionSignals = (Object.keys(signals) as (keyof typeof signals)[])
    .filter((k) => signals[k])
    .map((k) => `${SIGNAL_PHRASES[k]}: ${evidence[k]}`);

  return {
    id: lead.id,
    score: Math.max(0, Math.min(100, score)),
    reasons: reasons.length ? reasons : ["No strong ownership or longevity language in the available text"],
    risks,
    acquisitionSignals,
  };
}

/**
 * Deterministic stand-in for an LLM so the whole product works offline and in CI.
 * It reads the same structured input a hosted model would be prompted with.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "heuristic-v1";

  async completeJson(req: CompletionRequest): Promise<string> {
    if (req.task === "score") {
      const input = req.input as ScoreInput;
      return JSON.stringify({ assessments: input.leads.map((l) => assess(input.icp, l)) });
    }
    const input = req.input as OutreachInput;
    return JSON.stringify(renderTemplate(input.facts, input.tone, input.sender));
  }
}
