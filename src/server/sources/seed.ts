import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv";
import type { DiscoverOptions, LeadSource, RawCompany } from "./LeadSource";

const SEED_PATH = path.join(process.cwd(), "data", "sample_companies.csv");

let cache: RawCompany[] | null = null;

async function load(): Promise<RawCompany[]> {
  if (!cache) {
    const text = await readFile(SEED_PATH, "utf8");
    cache = parseCsv(text).companies;
  }
  return cache;
}

export const seedSource: LeadSource = {
  id: "seed",
  label: "Sample SMB dataset",
  description: "~150 fictional small and mid-sized businesses bundled with the app. No network calls.",
  async discover({ industries = [], limit = 500 }: DiscoverOptions = {}) {
    const all = await load();
    const wanted = new Set(industries.map((i) => i.toLowerCase()));
    const filtered = wanted.size ? all.filter((c) => c.industry && wanted.has(c.industry.toLowerCase())) : all;
    return filtered.slice(0, limit);
  },
  async facets() {
    const all = await load();
    return { industries: [...new Set(all.map((c) => c.industry).filter((i): i is string => !!i))].sort() };
  },
};
