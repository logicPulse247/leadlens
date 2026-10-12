import { z } from "zod";

export const TIERS = ["A", "B", "C"] as const;
export const LEAD_STATUSES = ["NEW", "ENRICHING", "ENRICHED", "FAILED", "QUALIFIED", "REJECTED"] as const;
export const TONES = ["formal", "friendly", "founder"] as const;

export const TONE_LABELS: Record<(typeof TONES)[number], string> = {
  formal: "Formal",
  friendly: "Friendly",
  founder: "Founder-to-founder",
};

const stringList = z.array(z.string().trim().min(1).max(80)).max(50).default([]);

export const signalsSchema = z.object({
  ownerOperated: z.boolean().default(false),
  longEstablished: z.boolean().default(false),
  noRecentFunding: z.boolean().default(false),
  hiringSlowdown: z.boolean().default(false),
});
export type Signals = z.infer<typeof signalsSchema>;

export const SIGNAL_LABELS: Record<keyof Signals, { label: string; hint: string }> = {
  ownerOperated: { label: "Owner-operated", hint: "Founder or family still runs the business day to day." },
  longEstablished: { label: "Long-established", hint: "In business 15+ years; likely a succession candidate." },
  noRecentFunding: { label: "No recent funding", hint: "No VC/PE investment signals; likely still founder-controlled." },
  hiringSlowdown: { label: "Hiring slowdown", hint: "Few or no open roles; growth has plateaued." },
};

export const icpInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    industries: stringList,
    locations: stringList,
    minEmployees: z.number().int().min(0).max(1_000_000).nullable().default(null),
    maxEmployees: z.number().int().min(0).max(1_000_000).nullable().default(null),
    includeKeywords: stringList,
    excludeKeywords: stringList,
    signals: signalsSchema.default({}),
  })
  .refine((v) => v.minEmployees == null || v.maxEmployees == null || v.minEmployees <= v.maxEmployees, {
    message: "Minimum employees cannot exceed maximum",
    path: ["maxEmployees"],
  });
export type IcpInput = z.infer<typeof icpInputSchema>;

export const idParamSchema = z.object({ id: z.string().min(1) });

export const importBodySchema = z.object({
  mode: z.enum(["csv", "paste"]),
  text: z.string().min(1, "Nothing to import").max(5_000_000),
  icpId: z.string().min(1).nullable().optional(),
  enrich: z.boolean().default(false),
});

export const discoverBodySchema = z.object({
  sourceId: z.string().min(1).default("seed"),
  industries: z.array(z.string()).max(50).default([]),
  limit: z.number().int().min(1).max(1000).default(500),
  icpId: z.string().min(1).nullable().optional(),
  enrich: z.boolean().default(false),
});

export const leadFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  tier: z.enum(TIERS).optional(),
  industry: z.string().max(100).optional(),
  icpId: z.string().max(50).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

export const SORTABLE_FIELDS = ["name", "score", "tier", "status", "industry", "employees", "createdAt"] as const;

export const leadListQuerySchema = leadFiltersSchema.extend({
  sort: z.enum(SORTABLE_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const bulkStatusBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  status: z.enum(["QUALIFIED", "REJECTED", "NEW"]),
});

export const savedViewBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: leadFiltersSchema.extend({
    sort: z.enum(SORTABLE_FIELDS).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),
});

export const exportBodySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  ids: z.array(z.string().min(1)).min(1).max(5000).optional(),
  filters: leadFiltersSchema.optional(),
});

export const suppressionBodySchema = z.object({
  entries: z.array(z.string().trim().min(1).max(254)).min(1, "Enter at least one domain or email").max(500),
  reason: z.string().trim().max(200).optional(),
});
