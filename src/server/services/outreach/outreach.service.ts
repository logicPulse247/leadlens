import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/logger";
import { generateStructured, getProvider, type LLMProvider } from "@/server/ai/provider";
import { prisma } from "@/server/db/prisma";
import { ServiceError } from "@/server/errors";
import { contentHash, llmCacheGet, llmCacheSet } from "@/server/services/llmCache";
import { isDomainSuppressed } from "@/server/services/suppression.service";
import { buildFactSheet, numbersIn, type Fact } from "./facts";
import { renderTemplate, type DraftContent, type Sender, type Tone } from "./templates";

const log = childLogger("outreach");
const PROMPT_VERSION = "outreach-v1";

export const draftSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(40).max(1800),
  factsUsed: z.array(z.string()).max(12).default([]),
});

const TONE_GUIDE: Record<Tone, string> = {
  formal: 'Formal and polished. Open with "Dear <Company> team,". No contractions, no slang, measured and respectful.',
  friendly: 'Warm and conversational. Open with "Hi <Company> team,". Light touch, approachable, still professional.',
  founder:
    "Founder-to-founder: peer-level, candid, plain-spoken, short sentences. Do NOT claim any personal history or credentials that are not in the facts.",
};

function systemPrompt(tone: Tone) {
  return `You write short, personalised cold emails for a private-equity / M&A firm that acquires small businesses.
Hard rules:
- Use ONLY the facts in the FACT SHEET. Never invent facts, numbers, names, awards, customers, news, or relationships.
- Reference at least one specific fact from the sheet, and list the ids of every fact you used in "factsUsed".
- Do not include any number that is not in the fact sheet. No placeholders such as [Name] or {{company}}.
- The body must be under 130 words, end with the sender signature (name, then firm), and make one small, low-pressure ask.
- Tone: ${TONE_GUIDE[tone]}
Return JSON: {"subject": string, "body": string, "factsUsed": string[]}`;
}

export function senderFromEnv(): Sender {
  const env = getEnv();
  return { name: env.OUTREACH_SENDER_NAME, firm: env.OUTREACH_SENDER_FIRM };
}

/**
 * Programmatic guard against hallucination. Returns a list of problems; empty means the draft is acceptable.
 * Checks: only known fact ids, no numbers outside the fact sheet/signature, no placeholders, names the company.
 */
export function validateDraft(draft: DraftContent, facts: Fact[], sender: Sender): string[] {
  const problems: string[] = [];
  const ids = new Set(facts.map((f) => f.id));
  const unknown = draft.factsUsed.filter((id) => !ids.has(id));
  if (unknown.length) problems.push(`factsUsed contains unknown ids: ${unknown.join(", ")}`);

  const allowed = new Set([...facts.flatMap((f) => numbersIn(f.text)), ...numbersIn(sender.name), ...numbersIn(sender.firm)]);
  const invented = numbersIn(`${draft.subject} ${draft.body}`).filter((n) => !allowed.has(n));
  if (invented.length) problems.push(`mentions numbers that are not in the fact sheet: ${[...new Set(invented)].join(", ")}`);

  if (/\[[^\]]+\]|\{\{[^}]+\}\}/.test(draft.body)) problems.push("contains an unfilled placeholder");
  const company = facts.find((f) => f.id === "name")?.text.replace(/^Company name: /, "") ?? "";
  if (company && !`${draft.subject} ${draft.body}`.toLowerCase().includes(company.toLowerCase())) problems.push("does not mention the company by name");
  if (facts.length > 1 && !draft.factsUsed.some((id) => id !== "name")) problems.push("does not reference any specific fact about the company");
  return problems;
}

export interface GeneratedDraft extends DraftContent {
  source: "llm" | "template";
}

export async function composeDraft(facts: Fact[], tone: Tone, sender: Sender, provider: LLMProvider): Promise<GeneratedDraft> {
  const cacheKey = contentHash({ v: PROMPT_VERSION, provider: `${provider.name}:${provider.model}`, tone, sender, facts });
  const cached = await llmCacheGet<GeneratedDraft>(cacheKey);
  if (cached) return cached;

  const user = `FACT SHEET (ids in brackets):\n${facts.map((f) => `[${f.id}] ${f.text}`).join("\n")}\n\nSender: ${sender.name}, ${sender.firm}\nTone: ${tone}`;
  const input = { facts, tone, sender };
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const draft = await generateStructured(provider, { task: "outreach", system: systemPrompt(tone), user: user + feedback, input, maxTokens: 700 }, draftSchema);
      const problems = validateDraft(draft, facts, sender);
      if (!problems.length) {
        const result: GeneratedDraft = { ...draft, source: "llm" };
        await llmCacheSet(cacheKey, "outreach", result);
        return result;
      }
      feedback = `\n\nYour previous draft was rejected because it ${problems.join("; ")}. Fix this using only the fact sheet.`;
      log.warn({ attempt, problems }, "outreach draft failed fact validation");
    } catch (err) {
      log.warn({ attempt, err: String(err) }, "outreach generation failed");
      break;
    }
  }
  return { ...renderTemplate(facts, tone, sender), source: "template" };
}

export async function generateDraft(leadId: string, tone: Tone, opts: { provider?: LLMProvider; sender?: Sender } = {}) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { enrichment: true } });
  if (await isDomainSuppressed(lead.domain)) {
    throw new ServiceError("SUPPRESSED", "This company is on the suppression list. No outreach will be drafted.", 409);
  }
  const facts = buildFactSheet({
    name: lead.name,
    industry: lead.industry,
    location: lead.location,
    foundedYear: lead.foundedYear,
    description: lead.description,
    about: lead.enrichment?.about ?? null,
  });
  const provider = opts.provider ?? (await getProvider());
  const sender = opts.sender ?? senderFromEnv();
  const draft = await composeDraft(facts, tone, sender, provider);

  const used = facts.filter((f) => draft.factsUsed.includes(f.id));
  const data = {
    subject: draft.subject,
    body: draft.body,
    factsUsed: used as unknown as Prisma.InputJsonValue,
    edited: false,
  };
  const saved = await prisma.outreachDraft.upsert({
    where: { leadId_tone: { leadId, tone } },
    create: { leadId, tone, ...data },
    update: data,
  });
  log.info({ leadId, tone, source: draft.source }, "outreach draft generated");
  return { draft: saved, source: draft.source };
}

export const draftEditSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export async function updateDraft(id: string, input: z.infer<typeof draftEditSchema>) {
  return prisma.outreachDraft.update({ where: { id }, data: { ...input, edited: true } });
}
