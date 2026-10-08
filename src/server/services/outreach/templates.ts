import type { Fact } from "./facts";

export type Tone = "formal" | "friendly" | "founder";

export interface Sender {
  name: string;
  firm: string;
}

export interface DraftContent {
  subject: string;
  body: string;
  factsUsed: string[];
}

const byId = (facts: Fact[], id: string) => facts.find((f) => f.id === id);

function quoted(f: Fact | undefined): string | null {
  return f?.text.match(/"([^"]+)"/)?.[1] ?? null;
}

function locationOf(facts: Fact[]): string | null {
  return byId(facts, "location")?.text.replace(/^Based in /, "") ?? null;
}

function companyOf(facts: Fact[]): string {
  return byId(facts, "name")!.text.replace(/^Company name: /, "");
}

const YEARS_RE = /about (\d+) years/;
const SINCE_RE = /since (\d{4})/;

interface Hook {
  line: string;
  used: string[];
}

/** Builds the personalised opening from whichever real facts exist, strongest first. */
function buildHook(facts: Fact[], tone: Tone): Hook {
  const company = companyOf(facts);
  const location = locationOf(facts);
  const years = byId(facts, "years");
  const ownership = quoted(byId(facts, "ownership"));
  const about = byId(facts, "about_1");
  const used = ["name"];
  const parts: string[] = [];

  if (years) {
    const since = years.text.match(SINCE_RE)![1];
    const n = years.text.match(YEARS_RE)?.[1];
    used.push("years");
    parts.push(
      tone === "founder"
        ? `${company} has been around since ${since}${n ? `, about ${n} years` : ""}. That doesn't happen by accident.`
        : `${company} has been serving ${location ?? "its community"} since ${since}${n ? ` (about ${n} years)` : ""}`,
    );
  }
  if (ownership) {
    used.push("ownership");
    parts.push(`your website describes the business as “${ownership}”`);
  }
  if (!parts.length && about) {
    used.push("about_1");
    parts.push(`your site says: “${quoted(about)}”`);
  }
  if (location && !used.includes("years")) used.push("location");

  const lead =
    tone === "formal"
      ? `I am writing because I came across ${company}${location ? ` in ${location}` : ""}`
      : tone === "friendly"
        ? `I came across ${company}${location ? ` in ${location}` : ""} and wanted to reach out`
        : `I'll be direct. I found ${company}${location ? ` (${location})` : ""} and it stood out`;

  if (!parts.length) return { line: `${lead}.`, used };
  if (tone === "founder" && years) return { line: `${parts[0]}${parts[1] ? ` Also, ${parts[1]}.` : ""}`, used };
  return { line: `${lead}: ${parts.join(", and ")}.`, used };
}

const PITCH: Record<Tone, (firm: string) => string> = {
  formal: (firm) =>
    `${firm} partners with the owners of established small businesses who are considering what comes next, whether that is a full sale, a partial sale, or a growth partner. We would welcome the opportunity to learn more about your plans.`,
  friendly: (firm) =>
    `At ${firm} we work with owners of established small businesses who are starting to think about what's next for the company, and for themselves. No pressure at all, I'd just love to hear how you see the future.`,
  founder: (firm) =>
    `${firm} buys and backs small businesses from owners who care what happens to their people and customers afterward. If you've ever wondered what a good exit could look like, I'm happy to talk through it. Nothing formal.`,
};

const CTA: Record<Tone, string> = {
  formal: "Would you be open to a brief, confidential conversation in the coming weeks?",
  friendly: "Would a quick call sometime next week work?",
  founder: "Worth a short call?",
};

const GREETING: Record<Tone, (company: string) => string> = {
  formal: (c) => `Dear ${c} team,`,
  friendly: (c) => `Hi ${c} team,`,
  founder: () => "Hello,",
};

const SIGNOFF: Record<Tone, string> = { formal: "Sincerely,", friendly: "Thanks,", founder: "Best," };

/** Deterministic, fact-grounded draft. Also the safety net when an LLM draft fails validation. */
export function renderTemplate(facts: Fact[], tone: Tone, sender: Sender): DraftContent {
  const company = companyOf(facts);
  const hook = buildHook(facts, tone);
  const body = [GREETING[tone](company), "", hook.line, "", PITCH[tone](sender.firm), "", CTA[tone], "", SIGNOFF[tone], sender.name, sender.firm].join("\n");
  const subject =
    tone === "formal" ? `Introduction: ${sender.firm} and ${company}` : tone === "friendly" ? `Quick hello from ${sender.firm}` : `${company}: a direct note`;
  return { subject, body, factsUsed: hook.used };
}
