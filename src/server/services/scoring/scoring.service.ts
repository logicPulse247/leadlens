import type { Prisma } from "@prisma/client";
import { childLogger } from "@/lib/logger";
import { signalsSchema } from "@/lib/schemas";
import { getProvider, generateStructured, type LLMProvider } from "@/server/ai/provider";
import { prisma } from "@/server/db/prisma";
import { contentHash, llmCacheGet, llmCacheSet } from "@/server/services/llmCache";
import { blendScores } from "./blend";
import { computeRuleScore, type IcpCriteria, type LeadFacts } from "./rules";
import { llmBatchSchema, type CachedAssessment } from "./schemas";

const log = childLogger("scoring");

export const PROMPT_VERSION = "score-v1";
export const LLM_BATCH_SIZE = 8;
const MIN_TEXT_FOR_LLM = 40;

export interface ScoreRunStats {
  scored: number;
  skipped: number;
  llmCalls: number;
  cacheHits: number;
  llmFailures: number;
}

const SYSTEM_PROMPT = `You are an analyst for a private-equity firm that acquires small, founder-owned businesses.
For each company, assess how well it fits the Ideal Customer Profile (ICP) and how likely it is to be an acquirable, owner-operated business.
Rules:
- Use ONLY the facts supplied for each company. Never invent facts, numbers, names or events.
- If something is unknown, say so in "risks" instead of guessing.
- "reasons" are concrete strengths grounded in the supplied text. "risks" are concerns. "acquisitionSignals" are signs of owner-operation, long history, no outside funding or a hiring slowdown, each citing the text.
- Keep every string under 200 characters.
Return JSON: {"assessments":[{"id":string,"score":integer 0-100,"reasons":string[],"risks":string[],"acquisitionSignals":string[]}]} with exactly one entry per company id.`;

export function toCriteria(icp: {
  industries: string[];
  locations: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  signals: unknown;
}): IcpCriteria {
  return {
    industries: icp.industries,
    locations: icp.locations,
    minEmployees: icp.minEmployees,
    maxEmployees: icp.maxEmployees,
    includeKeywords: icp.includeKeywords,
    excludeKeywords: icp.excludeKeywords,
    signals: signalsSchema.parse(icp.signals ?? {}),
  };
}

interface LeadRecord {
  id: string;
  name: string;
  industry: string | null;
  location: string | null;
  employees: number | null;
  foundedYear: number | null;
  description: string | null;
  scoreHash: string | null;
  score: number | null;
  enrichment: { about: string | null; techStack: string[] } | null;
}

export function toFacts(lead: LeadRecord): LeadFacts {
  const parts = [lead.enrichment?.about, lead.description].filter((p): p is string => !!p && p.trim().length > 0);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.includes(p) || p.includes(q)) === i);
  return {
    name: lead.name,
    industry: lead.industry,
    location: lead.location,
    employees: lead.employees,
    foundedYear: lead.foundedYear,
    text: unique.join(" ").slice(0, 1200),
    techStack: lead.enrichment?.techStack ?? [],
  };
}

export function scoreHashFor(criteria: IcpCriteria, facts: LeadFacts, provider: Pick<LLMProvider, "name" | "model">): string {
  return contentHash({ v: PROMPT_VERSION, provider: `${provider.name}:${provider.model}`, icp: criteria, lead: facts });
}

async function assessBatch(
  provider: LLMProvider,
  criteria: IcpCriteria,
  batch: { id: string; facts: LeadFacts }[],
): Promise<Map<string, CachedAssessment>> {
  const input = {
    icp: criteria,
    leads: batch.map(({ id, facts }) => ({
      id,
      name: facts.name,
      industry: facts.industry,
      location: facts.location,
      employees: facts.employees,
      foundedYear: facts.foundedYear,
      text: facts.text,
    })),
  };
  const user = `ICP:\n${JSON.stringify(input.icp)}\n\nCompanies:\n${JSON.stringify(input.leads)}`;
  const parsed = await generateStructured(provider, { task: "score", system: SYSTEM_PROMPT, user, input, maxTokens: 400 + batch.length * 350 }, llmBatchSchema);
  const wanted = new Set(batch.map((b) => b.id));
  const out = new Map<string, CachedAssessment>();
  for (const { id, ...rest } of parsed.assessments) if (wanted.has(id)) out.set(id, rest);
  return out;
}

/**
 * Scores leads against an ICP.
 * - Skips leads whose content hash is unchanged (no work at all).
 * - Serves LLM assessments from Redis/Postgres cache when the same content was seen before.
 * - Sends only cache misses to the model, LLM_BATCH_SIZE companies per request.
 * - Falls back to rules-only for a lead if the model fails; the failure is never cached.
 */
export async function scoreLeads(leadIds: string[], icpId: string, opts: { force?: boolean; provider?: LLMProvider } = {}): Promise<ScoreRunStats> {
  const stats: ScoreRunStats = { scored: 0, skipped: 0, llmCalls: 0, cacheHits: 0, llmFailures: 0 };
  const ids = [...new Set(leadIds)];
  if (!ids.length) return stats;

  const icp = await prisma.icp.findUniqueOrThrow({ where: { id: icpId } });
  const criteria = toCriteria(icp);
  const provider = opts.provider ?? (await getProvider());

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, industry: true, location: true, employees: true, foundedYear: true, description: true, scoreHash: true, score: true, icpId: true,
      enrichment: { select: { about: true, techStack: true } },
    },
  });

  const work: { lead: (typeof leads)[number]; facts: LeadFacts; hash: string; llm: CachedAssessment | null; fromCache: boolean }[] = [];
  for (const lead of leads) {
    const facts = toFacts(lead);
    const hash = scoreHashFor(criteria, facts, provider);
    if (!opts.force && lead.score != null && lead.scoreHash === hash && lead.icpId === icpId) {
      stats.skipped++;
      continue;
    }
    const cached = facts.text.length >= MIN_TEXT_FOR_LLM ? await llmCacheGet<CachedAssessment>(hash) : null;
    if (cached) stats.cacheHits++;
    work.push({ lead, facts, hash, llm: cached, fromCache: !!cached });
  }

  const misses = work.filter((w) => !w.llm && w.facts.text.length >= MIN_TEXT_FOR_LLM);
  for (let i = 0; i < misses.length; i += LLM_BATCH_SIZE) {
    const chunk = misses.slice(i, i + LLM_BATCH_SIZE);
    stats.llmCalls++;
    try {
      const results = await assessBatch(provider, criteria, chunk.map((c) => ({ id: c.lead.id, facts: c.facts })));
      for (const c of chunk) {
        const r = results.get(c.lead.id);
        if (!r) {
          stats.llmFailures++;
          continue;
        }
        c.llm = r;
        await llmCacheSet(c.hash, "score", r);
      }
    } catch (err) {
      stats.llmFailures += chunk.length;
      log.warn({ err: String(err), size: chunk.length }, "LLM batch failed; falling back to rules for these leads");
    }
  }

  for (const w of work) {
    const rules = computeRuleScore(criteria, w.facts);
    const result = blendScores(rules, w.llm);
    const details = {
      ...result,
      rules: { industry: rules.industry, size: rules.size, location: rules.location, keywords: rules.keywords, signals: rules.signals, penalty: rules.penalty, total: rules.total },
      ...(w.llm ? { llm: { score: w.llm.score, provider: provider.name, model: provider.model, cached: w.fromCache } } : {}),
    };
    await prisma.lead.update({
      where: { id: w.lead.id },
      data: {
        score: result.score,
        tier: result.tier,
        scoreDetails: details as Prisma.InputJsonValue,
        // Without an LLM result the hash stays empty so the next run retries the AI step.
        scoreHash: w.llm ? w.hash : null,
        icpId,
      },
    });
    stats.scored++;
  }

  log.info({ ...stats, icpId, provider: provider.name, requested: ids.length }, "scoring run complete");
  return stats;
}
