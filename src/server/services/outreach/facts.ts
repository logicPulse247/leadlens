import { detectSignals } from "@/server/services/scoring/rules";

export interface Fact {
  id: string;
  text: string;
}

export interface FactSource {
  name: string;
  industry: string | null;
  location: string | null;
  foundedYear: number | null;
  description: string | null;
  about: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 220);
}

/**
 * The only things an outreach email may claim about a company.
 * Each fact is traceable to the CSV row or the company's own public website.
 */
export function buildFactSheet(src: FactSource): Fact[] {
  const facts: Fact[] = [{ id: "name", text: `Company name: ${src.name}` }];
  if (src.industry) facts.push({ id: "industry", text: `Industry: ${src.industry}` });
  if (src.location) facts.push({ id: "location", text: `Based in ${src.location}` });
  if (src.foundedYear && src.foundedYear <= CURRENT_YEAR) {
    facts.push({ id: "years", text: `In business since ${src.foundedYear} (about ${CURRENT_YEAR - src.foundedYear} years)` });
  }

  const text = [src.about, src.description].filter(Boolean).join(" ");
  const { evidence } = detectSignals({ text, foundedYear: src.foundedYear });
  if (evidence.ownerOperated) facts.push({ id: "ownership", text: `Their own website describes the business as ${evidence.ownerOperated}` });

  const seen = new Set<string>();
  let n = 0;
  for (const s of sentences(text)) {
    const key = s.toLowerCase();
    if (seen.has(key) || /all rights reserved|©|cookie/i.test(s)) continue;
    // Skip sentences that only restate funding/hiring chatter; they make poor openers.
    if (/hiring|open positions|funding round|venture|private equity/i.test(s)) continue;
    seen.add(key);
    facts.push({ id: `about_${++n}`, text: `Their website says: "${s}"` });
    if (n >= 3) break;
  }
  return facts;
}

export function numbersIn(text: string): string[] {
  return text.match(/\d[\d,.]*/g)?.map((n) => n.replace(/[,.]+$/, "")) ?? [];
}
