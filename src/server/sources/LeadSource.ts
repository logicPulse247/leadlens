/** A company as reported by any source, before normalization and persistence. */
export interface RawCompany {
  name: string;
  domain?: string | null;
  industry?: string | null;
  location?: string | null;
  employees?: number | null;
  foundedYear?: number | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DiscoverOptions {
  industries?: string[];
  limit?: number;
}

/**
 * Anything that can produce companies. The seed dataset implements this today;
 * a real provider (Apollo, a Maps scraper, a state business registry) can be added
 * by implementing this interface and registering it in `sources/index.ts`.
 */
export interface LeadSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  discover(options?: DiscoverOptions): Promise<RawCompany[]>;
  /** Distinct industries available, used to populate filters in the UI. */
  facets?(): Promise<{ industries: string[] }>;
}
