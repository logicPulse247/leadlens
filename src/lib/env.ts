import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380"),
  LLM_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-haiku-latest"),
  ENRICHMENT_USER_AGENT: z
    .string()
    .default("LeadLensBot/1.0 (+https://example.com/bot; contact: bot@example.com)"),
  ENRICHMENT_TTL_HOURS: z.coerce.number().int().positive().default(168),
  ENRICHMENT_DOMAIN_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  ENRICHMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  ENRICHMENT_CONCURRENCY: z.coerce.number().int().positive().default(4),
  ENRICHMENT_OFFLINE: bool,
  OUTREACH_SENDER_NAME: z.string().min(1).default("Alex Morgan"),
  OUTREACH_SENDER_FIRM: z.string().min(1).default("Caprae Capital"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
