import type { Signals } from "./schemas";

export interface IcpView {
  id: string;
  name: string;
  industries: string[];
  locations: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  signals: Signals;
  createdAt: string;
  updatedAt: string;
}

export interface EmailRecord {
  address: string;
  syntaxValid: boolean;
  mxValid: boolean | null;
  kind: "generic" | "personal" | "unknown";
  sourceUrl?: string;
}

export interface EnrichmentView {
  emails: EmailRecord[];
  phones: string[];
  socials: Record<string, string>;
  about: string | null;
  techStack: string[];
  sourceUrls: string[];
  robotsAllowed: boolean;
  error: string | null;
  fetchedAt: string;
  expiresAt: string;
}

export interface ScoreDetails {
  score: number;
  tier: "A" | "B" | "C";
  reasons: string[];
  risks: string[];
  acquisitionSignals: string[];
  rules?: { industry: number; size: number; location: number; keywords: number; signals: number; total: number };
  llm?: { score: number; provider: string; cached: boolean };
}

export interface LeadRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  employees: number | null;
  status: "NEW" | "ENRICHING" | "ENRICHED" | "FAILED" | "QUALIFIED" | "REJECTED";
  score: number | null;
  tier: "A" | "B" | "C" | null;
  icpId: string | null;
  createdAt: string;
  updatedAt: string;
  enrichment: { fetchedAt: string; error: string | null; emails: EmailRecord[]; phones: string[] } | null;
}

export interface LeadListResponse {
  items: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface DraftView {
  id: string;
  leadId: string;
  tone: string;
  subject: string;
  body: string;
  factsUsed: string[];
  edited: boolean;
  updatedAt: string;
}

export interface LeadDetail extends Omit<LeadRow, "enrichment"> {
  description: string | null;
  foundedYear: number | null;
  source: string;
  scoreDetails: ScoreDetails | null;
  enrichment: EnrichmentView | null;
  drafts: DraftView[];
  icp: { id: string; name: string } | null;
}

export interface SavedViewDto {
  id: string;
  name: string;
  filters: Record<string, string | number | undefined>;
}

export interface JobView {
  id: string;
  type: "ENRICH" | "SCORE" | "IMPORT";
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  total: number;
  done: number;
  failed: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
