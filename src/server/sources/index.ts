import type { LeadSource } from "./LeadSource";
import { seedSource } from "./seed";

const sources: LeadSource[] = [seedSource];

export function listSources(): LeadSource[] {
  return sources;
}

export function getSource(id: string): LeadSource | undefined {
  return sources.find((s) => s.id === id);
}

export type { LeadSource, RawCompany } from "./LeadSource";
