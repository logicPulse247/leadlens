import { childLogger } from "@/lib/logger";
import { extractFromHtml, type Extracted } from "./extractor";
import { FetchError, type FetchResult, type PageFetcher } from "./fetcher";
import type { DomainRateLimiter } from "./rateLimiter";
import { RobotsService, type RobotsCache, type RobotsFile } from "./robots";

const log = childLogger("crawl");

export interface CrawlConfig {
  userAgent: string;
  delayMs: number;
  robotsCache?: RobotsCache;
  maxExtraPages?: number;
}

export interface CrawlOutput {
  robotsAllowed: boolean;
  error: string | null;
  emails: { address: string; sourceUrl: string }[];
  phones: string[];
  socials: Record<string, string>;
  about: string | null;
  techStack: string[];
  sourceUrls: string[];
}

/** Decorates a fetcher so every request waits for the shared per-host slot. */
class PoliteFetcher implements PageFetcher {
  delayMs: number;
  constructor(
    private readonly inner: PageFetcher,
    private readonly limiter: DomainRateLimiter,
    delayMs: number,
  ) {
    this.delayMs = delayMs;
  }
  async get(url: string): Promise<FetchResult> {
    await this.limiter.acquire(new URL(url).hostname.replace(/^www\./, ""), this.delayMs);
    return this.inner.get(url);
  }
}

const isHtml = (r: FetchResult) => /html|xml/i.test(r.contentType) || r.body.trimStart().startsWith("<");

function emptyOutput(): CrawlOutput {
  return { robotsAllowed: true, error: null, emails: [], phones: [], socials: {}, about: null, techStack: [], sourceUrls: [] };
}

/**
 * Crawls at most 1 + maxExtraPages public pages of a company site.
 * Every request is gated by robots.txt and the per-domain rate limiter.
 * Never follows links off-site and never touches LinkedIn or any login-gated area.
 */
export async function crawlSite(domain: string, fetcher: PageFetcher, limiter: DomainRateLimiter, cfg: CrawlConfig): Promise<CrawlOutput> {
  const polite = new PoliteFetcher(fetcher, limiter, cfg.delayMs);
  const robots = new RobotsService(
    cfg.userAgent,
    async (origin): Promise<RobotsFile> => {
      const res = await polite.get(`${origin}/robots.txt`);
      return { status: res.status, body: res.status === 200 ? res.body.slice(0, 500_000) : "" };
    },
    cfg.robotsCache,
  );

  const out = emptyOutput();
  const bases = [`https://${domain}`, `https://www.${domain}`, `http://${domain}`];
  let homeUrl: string | null = null;
  let home: FetchResult | null = null;
  let lastError: string | null = null;

  for (const base of bases) {
    try {
      const decision = await robots.check(`${base}/`);
      if (!decision.allowed) {
        out.robotsAllowed = false;
        out.error = decision.reason ?? "Disallowed by robots.txt";
        return out;
      }
      if (decision.crawlDelayMs) polite.delayMs = Math.max(polite.delayMs, decision.crawlDelayMs);
      const res = await polite.get(`${base}/`);
      if (res.status >= 400 || !isHtml(res)) {
        lastError = `Homepage returned HTTP ${res.status}`;
        continue;
      }
      home = res;
      homeUrl = res.url;
      break;
    } catch (err) {
      lastError = err instanceof FetchError ? err.message : `Unexpected error: ${String(err)}`;
      log.debug({ domain, base, err: lastError }, "base url failed");
    }
  }

  if (!home || !homeUrl) {
    out.error = lastError ?? "Website unreachable";
    return out;
  }

  const pages: { url: string; data: Extracted }[] = [{ url: homeUrl, data: extractFromHtml(home.body, homeUrl) }];
  const candidates = new Set(pages[0].data.nextLinks);
  if (!candidates.size) candidates.add(new URL("/contact", homeUrl).toString());

  for (const url of [...candidates].slice(0, cfg.maxExtraPages ?? 2)) {
    try {
      const decision = await robots.check(url);
      if (!decision.allowed) continue;
      const res = await polite.get(url);
      if (res.status >= 400 || !isHtml(res)) continue;
      pages.push({ url: res.url, data: extractFromHtml(res.body, res.url) });
    } catch (err) {
      log.debug({ domain, url, err: String(err) }, "secondary page failed");
    }
  }

  const seenEmails = new Set<string>();
  for (const { url, data } of pages) {
    out.sourceUrls.push(url);
    for (const e of data.emails) {
      if (!seenEmails.has(e)) {
        seenEmails.add(e);
        out.emails.push({ address: e, sourceUrl: url });
      }
    }
    for (const p of data.phones) if (!out.phones.includes(p)) out.phones.push(p);
    for (const [k, v] of Object.entries(data.socials)) out.socials[k] ??= v;
    for (const t of data.techStack) if (!out.techStack.includes(t)) out.techStack.push(t);
  }

  const aboutPage = pages.find((p) => /about/i.test(new URL(p.url).pathname) && p.data.about);
  out.about = aboutPage?.data.about ?? pages.map((p) => p.data.about).find((a) => a && a.length >= 60) ?? pages[0].data.about;
  return out;
}
