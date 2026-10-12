import { route, ok } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { prisma } from "@/server/db/prisma";
import { getSuppressionSets, domainSuppressed } from "@/server/services/suppression.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const env = getEnv();
  const [sets, leads] = await Promise.all([getSuppressionSets(), prisma.lead.findMany({ where: { domain: { not: null } }, select: { domain: true } })]);
  return ok({
    crawler: {
      userAgent: env.ENRICHMENT_USER_AGENT,
      domainDelayMs: env.ENRICHMENT_DOMAIN_DELAY_MS,
      timeoutMs: env.ENRICHMENT_TIMEOUT_MS,
      ttlHours: env.ENRICHMENT_TTL_HOURS,
      concurrency: env.ENRICHMENT_CONCURRENCY,
      offline: env.ENRICHMENT_OFFLINE,
    },
    llmProvider: env.LLM_PROVIDER,
    suppressedLeads: leads.filter((l) => domainSuppressed(l.domain, sets)).length,
  });
});
