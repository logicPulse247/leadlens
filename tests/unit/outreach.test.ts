import { describe, expect, it } from "vitest";
import { generateStructured, LlmValidationError, type LLMProvider } from "@/server/ai/provider";
import { MockProvider } from "@/server/ai/mock";
import { buildFactSheet } from "@/server/services/outreach/facts";
import { composeDraft, draftSchema, validateDraft } from "@/server/services/outreach/outreach.service";
import { renderTemplate } from "@/server/services/outreach/templates";
import { llmBatchSchema } from "@/server/services/scoring/schemas";
import { vi } from "vitest";

vi.mock("@/server/services/llmCache", () => ({
  llmCacheGet: async () => null,
  llmCacheSet: async () => undefined,
  contentHash: () => "h",
}));

const sender = { name: "Alex Morgan", firm: "Caprae Capital" };
const facts = buildFactSheet({
  name: "Tidewater Heating & Air",
  industry: "HVAC",
  location: "Columbus, OH",
  foundedYear: 1987,
  description: "Tidewater provides residential heating and cooling in Columbus, OH. Family-owned and operated for three generations. Hiring technicians now.",
  about: null,
});

const scripted = (replies: string[]): LLMProvider & { calls: number } => {
  const p = {
    name: "scripted",
    model: "x",
    calls: 0,
    async completeJson() {
      return replies[Math.min(p.calls++, replies.length - 1)];
    },
  };
  return p;
};

describe("fact sheet", () => {
  it("contains only facts derived from the lead's data", () => {
    const ids = facts.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["name", "industry", "location", "years", "ownership"]));
    expect(facts.find((f) => f.id === "years")!.text).toContain("1987");
    expect(facts.find((f) => f.id === "ownership")!.text.toLowerCase()).toContain("family-owned");
  });

  it("skips hiring and funding chatter as outreach hooks", () => {
    expect(facts.some((f) => /hiring/i.test(f.text))).toBe(false);
  });

  it("falls back to name only when nothing else is known", () => {
    expect(buildFactSheet({ name: "Acme", industry: null, location: null, foundedYear: null, description: null, about: null })).toEqual([{ id: "name", text: "Company name: Acme" }]);
  });
});

describe("templates", () => {
  it.each(["formal", "friendly", "founder"] as const)("renders a %s draft that cites real facts and passes validation", (tone) => {
    const d = renderTemplate(facts, tone, sender);
    expect(d.body).toContain("Tidewater Heating & Air");
    expect(d.body).toContain("1987");
    expect(d.body).toContain(sender.firm);
    expect(validateDraft(d, facts, sender)).toEqual([]);
  });

  it("differs by tone", () => {
    const [a, b, c] = (["formal", "friendly", "founder"] as const).map((t) => renderTemplate(facts, t, sender).body);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("still produces a valid draft with a minimal fact sheet", () => {
    const minimal = buildFactSheet({ name: "Acme Plumbing", industry: null, location: null, foundedYear: null, description: null, about: null });
    const d = renderTemplate(minimal, "friendly", sender);
    expect(validateDraft(d, minimal, sender)).toEqual([]);
  });
});

describe("hallucination guard", () => {
  const good = renderTemplate(facts, "friendly", sender);

  it("rejects numbers that are not in the fact sheet", () => {
    const bad = { ...good, body: `${good.body}\nWe just helped a company like yours sell for 42 million.` };
    expect(validateDraft(bad, facts, sender).join(" ")).toMatch(/numbers.*42/);
  });

  it("rejects unknown fact ids, placeholders, missing company name and fact-free drafts", () => {
    expect(validateDraft({ ...good, factsUsed: ["made_up"] }, facts, sender).join(" ")).toMatch(/unknown ids/);
    expect(validateDraft({ ...good, body: `${good.body} [First Name]` }, facts, sender).join(" ")).toMatch(/placeholder/);
    expect(validateDraft({ ...good, subject: "Hello", body: "Hello there, I would love to chat about your future plans soon." }, facts, sender).join(" ")).toMatch(/company by name/);
    expect(validateDraft({ ...good, factsUsed: ["name"] }, facts, sender).join(" ")).toMatch(/specific fact/);
  });
});

describe("composeDraft", () => {
  const goodJson = JSON.stringify({ ...renderTemplate(facts, "friendly", sender), factsUsed: ["name", "years"] });

  it("uses a valid LLM draft", async () => {
    const p = scripted([goodJson]);
    const d = await composeDraft(facts, "friendly", sender, p);
    expect(d.source).toBe("llm");
    expect(p.calls).toBe(1);
  });

  it("retries once with feedback when the draft invents a number, then accepts the fix", async () => {
    const hallucinated = JSON.stringify({ ...JSON.parse(goodJson), body: `${JSON.parse(goodJson).body} Our fund has closed 300 deals.` });
    const p = scripted([hallucinated, goodJson]);
    const d = await composeDraft(facts, "friendly", sender, p);
    expect(p.calls).toBe(2);
    expect(d.source).toBe("llm");
    expect(d.body).not.toContain("300");
  });

  it("falls back to the fact-based template when the model keeps inventing facts", async () => {
    const hallucinated = JSON.stringify({ ...JSON.parse(goodJson), body: `${JSON.parse(goodJson).body} We saw your 2025 award.` });
    const d = await composeDraft(facts, "friendly", sender, scripted([hallucinated]));
    expect(d.source).toBe("template");
    expect(validateDraft(d, facts, sender)).toEqual([]);
  });

  it("falls back when the provider throws", async () => {
    const boom: LLMProvider = { name: "boom", model: "x", completeJson: async () => Promise.reject(new Error("network down")) };
    expect((await composeDraft(facts, "founder", sender, boom)).source).toBe("template");
  });

  it("works end to end with the mock provider", async () => {
    const d = await composeDraft(facts, "formal", sender, new MockProvider());
    expect(d.source).toBe("llm");
    expect(draftSchema.safeParse(d).success).toBe(true);
  });
});

describe("structured generation", () => {
  const schema = llmBatchSchema;
  const valid = JSON.stringify({ assessments: [{ id: "a", score: 71.6, reasons: ["Owner run business"], risks: [], acquisitionSignals: [] }] });

  it("parses fenced JSON and normalises with the zod schema", async () => {
    const out = await generateStructured(scripted(["```json\n" + valid + "\n```"]), { task: "score", system: "", user: "", input: {} }, schema);
    expect(out.assessments[0].score).toBe(72);
  });

  it("retries once on malformed output and includes the reason", async () => {
    const seen: string[] = [];
    const p: LLMProvider = {
      name: "p",
      model: "m",
      async completeJson(req) {
        seen.push(req.user);
        return seen.length === 1 ? "not json at all" : valid;
      },
    };
    const out = await generateStructured(p, { task: "score", system: "", user: "base", input: {} }, schema);
    expect(out.assessments).toHaveLength(1);
    expect(seen[1]).toMatch(/rejected.*invalid JSON/s);
  });

  it("rejects schema violations after the retry budget and raises a typed error", async () => {
    const bad = JSON.stringify({ assessments: [{ id: "a", score: 500 }] });
    await expect(generateStructured(scripted([bad]), { task: "score", system: "", user: "", input: {} }, schema)).rejects.toBeInstanceOf(LlmValidationError);
  });
});
