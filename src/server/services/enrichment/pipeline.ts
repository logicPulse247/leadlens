import type { Prisma } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/logger";
import type { EmailRecord, EnrichmentView } from "@/lib/types";
import { cacheGet, cacheSet } from "@/server/cache/cache";
import { prisma } from "@/server/db/prisma";
import { isDomainSuppressed } from "@/server/services/suppression.service";
import { isReservedDomain } from "@/server/services/validation/domain";
import { dnsMxResolver, validateEmail, type MxResolver } from "@/server/services/validation/email";
import { crawlSite, type CrawlOutput } from "./crawl";
import { HttpFetcher, type PageFetcher } from "./fetcher";
import { NoopRateLimiter, RedisDomainRateLimiter, type DomainRateLimiter } from "./rateLimiter";
import type { RobotsCache } from "./robots";
import { SyntheticFetcher, type SyntheticLead } from "./synthetic";

const log = childLogger("enrichment");

export type EnrichOutcome = "enriched" | "cached" | "blocked" | "failed" | "suppressed";

export interface Transport {
  fetcher: PageFetcher;
  limiter: DomainRateLimiter;
}

export interface EnrichmentDeps {
  /** Chooses how to reach a lead's site: real HTTP with polite throttling, or the offline synthetic site. */
  transportFor(lead: SyntheticLead): Transport;
  mx: MxResolver;
  robotsCache?: RobotsCache;
  userAgent: string;
  delayMs: number;
  ttlHours: number;
}

export function createDefaultDeps(): EnrichmentDeps {
  const env = getEnv();
  const http: Transport = {
    fetcher: new HttpFetcher({ userAgent: env.ENRICHMENT_USER_AGENT, timeoutMs: env.ENRICHMENT_TIMEOUT_MS }),
    limiter: new RedisDomainRateLimiter(),
  };
  const offlineLimiter = new NoopRateLimiter();
  return {
    transportFor: (lead) =>
      env.ENRICHMENT_OFFLINE || isReservedDomain(lead.domain)
        ? { fetcher: new SyntheticFetcher(lead), limiter: offlineLimiter }
        : http,
    mx: dnsMxResolver,
    robotsCache: { get: (k) => cacheGet(k), set: (k, v, ttl) => cacheSet(k, v, ttl) },
    userAgent: env.ENRICHMENT_USER_AGENT,
    delayMs: env.ENRICHMENT_DOMAIN_DELAY_MS,
    ttlHours: env.ENRICHMENT_TTL_HOURS,
  };
}

interface Snapshot {
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

const PIPELINE_STATES = ["NEW", "ENRICHING", "ENRICHED", "FAILED"] as const;

/** Pipeline status never overwrites a human decision (QUALIFIED / REJECTED). */
async function setPipelineStatus(leadId: string, status: (typeof PIPELINE_STATES)[number]) {
  await prisma.lead.updateMany({ where: { id: leadId, status: { in: [...PIPELINE_STATES] } }, data: { status } });
}

const cacheKey = (domain: string) => `enrich:${domain}`;

async function persist(leadId: string, snap: Snapshot) {
  const data = {
    emails: snap.emails as unknown as Prisma.InputJsonValue,
    phones: snap.phones,
    socials: snap.socials as Prisma.InputJsonValue,
    about: snap.about,
    techStack: snap.techStack,
    sourceUrls: snap.sourceUrls,
    robotsAllowed: snap.robotsAllowed,
    error: snap.error,
    fetchedAt: new Date(snap.fetchedAt),
    expiresAt: new Date(snap.expiresAt),
  };
  await prisma.enrichment.upsert({ where: { leadId }, create: { leadId, ...data }, update: data });
}

export function snapshotToView(s: Snapshot): EnrichmentView {
  return { ...s };
}

async function buildSnapshot(crawl: CrawlOutput, deps: EnrichmentDeps): Promise<Snapshot> {
  const now = new Date();
  const failed = !!crawl.error;
  // Failures are cached briefly so a dead site isn't hammered on every retry.
  const ttlMs = (failed ? 1 : deps.ttlHours) * 3600_000;
  const validated = (
    await Promise.all(crawl.emails.slice(0, 10).map((e) => validateEmail(e.address, deps.mx, e.sourceUrl)))
  ).filter((e): e is EmailRecord => !!e);
  return {
    emails: validated,
    phones: crawl.phones.slice(0, 5),
    socials: crawl.socials,
    about: crawl.about,
    techStack: crawl.techStack,
    sourceUrls: crawl.sourceUrls,
    robotsAllowed: crawl.robotsAllowed,
    error: crawl.error,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/**
 * Enriches one lead. Order of resolution: Redis -> Postgres (fresh row) -> live crawl.
 * `force` skips both caches (used by "Re-enrich").
 */
export async function enrichLead(leadId: string, deps: EnrichmentDeps, opts: { force?: boolean } = {}): Promise<EnrichOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { enrichment: true } });
  const l = log.child({ leadId, domain: lead.domain });

  if (!lead.domain) {
    await persist(leadId, emptyFailure("No website domain on file", deps));
    await setPipelineStatus(leadId, "FAILED");
    return "failed";
  }
  if (await isDomainSuppressed(lead.domain)) {
    await persist(leadId, emptyFailure("Domain is on the suppression list; not contacted", deps));
    await setPipelineStatus(leadId, "FAILED");
    l.info("skipped: suppressed");
    return "suppressed";
  }

  if (!opts.force) {
    const hot = await cacheGet<Snapshot>(cacheKey(lead.domain));
    if (hot) {
      await persist(leadId, hot);
      await setPipelineStatus(leadId, hot.error ? "FAILED" : "ENRICHED");
      l.info({ tier: "redis" }, "enrichment cache hit");
      return "cached";
    }
    const row = lead.enrichment;
    if (row && row.expiresAt > new Date()) {
      const snap: Snapshot = {
        emails: row.emails as unknown as EmailRecord[],
        phones: row.phones,
        socials: row.socials as Record<string, string>,
        about: row.about,
        techStack: row.techStack,
        sourceUrls: row.sourceUrls,
        robotsAllowed: row.robotsAllowed,
        error: row.error,
        fetchedAt: row.fetchedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
      await cacheSet(cacheKey(lead.domain), snap, Math.max(60, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)));
      await setPipelineStatus(leadId, row.error ? "FAILED" : "ENRICHED");
      l.info({ tier: "postgres" }, "enrichment cache hit");
      return "cached";
    }
  }

  const { fetcher, limiter } = deps.transportFor({
    name: lead.name,
    domain: lead.domain,
    industry: lead.industry,
    location: lead.location,
    description: lead.description,
    foundedYear: lead.foundedYear,
    phone: (lead.rawData as { phone?: string | null } | null)?.phone ?? null,
    email: (lead.rawData as { email?: string | null } | null)?.email ?? null,
  });
  const crawl = await crawlSite(lead.domain, fetcher, limiter, {
    userAgent: deps.userAgent,
    delayMs: deps.delayMs,
    robotsCache: deps.robotsCache,
  });
  const snap = await buildSnapshot(crawl, deps);
  await persist(leadId, snap);
  await cacheSet(cacheKey(lead.domain), snap, Math.max(60, Math.floor((new Date(snap.expiresAt).getTime() - Date.now()) / 1000)));
  await setPipelineStatus(leadId, snap.error ? "FAILED" : "ENRICHED");

  const outcome: EnrichOutcome = snap.error ? (snap.robotsAllowed ? "failed" : "blocked") : "enriched";
  l.info({ outcome, emails: snap.emails.length, phones: snap.phones.length, pages: snap.sourceUrls.length, error: snap.error }, "lead enriched");
  return outcome;
}

function emptyFailure(error: string, deps: EnrichmentDeps): Snapshot {
  const now = new Date();
  return {
    emails: [],
    phones: [],
    socials: {},
    about: null,
    techStack: [],
    sourceUrls: [],
    robotsAllowed: true,
    error,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.min(deps.ttlHours, 1) * 3600_000).toISOString(),
  };
}
