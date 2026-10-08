import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlSite } from "@/server/services/enrichment/crawl";
import { extractFromHtml } from "@/server/services/enrichment/extractor";
import { FetchError, HttpFetcher, assertPublicUrl, isPrivateIp } from "@/server/services/enrichment/fetcher";
import { NoopRateLimiter } from "@/server/services/enrichment/rateLimiter";
import { SyntheticFetcher, siteBehavior } from "@/server/services/enrichment/synthetic";

const HTML = `<!doctype html><html><head><title>Acme Plumbing</title>
<meta name="description" content="Family-owned plumbing in Columbus since 1987.">
<meta name="generator" content="WordPress 6.4">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></head>
<body><header><nav><a href="/about-us">About us</a><a href="/contact">Contact</a><a href="https://other.com/contact">Partner</a></nav></header>
<main><p>Acme Plumbing has served Columbus homeowners for over thirty years with honest, upfront pricing.</p>
<p>Call <a href="tel:+16145550132">(614) 555-0132</a> or email <a href="mailto:Info@acme.test?subject=Hi">us</a>.</p>
<img src="/logo@2x.png"></main>
<footer><a href="https://www.facebook.com/acmeplumbing">FB</a> <a href="https://linkedin.com/company/acme">LI</a>
<a href="https://www.linkedin.com/in/john-smith">owner</a> Reach the owner at john.smith@acme.test. &copy; 2026 Acme. All rights reserved.</footer></body></html>`;

describe("extractFromHtml", () => {
  const out = extractFromHtml(HTML, "https://acme.test/");

  it("finds mailto and in-text emails, lowercased, ignoring image-like false positives", () => {
    expect(out.emails.sort()).toEqual(["info@acme.test", "john.smith@acme.test"]);
  });

  it("normalizes phones to E.164 and de-duplicates", () => {
    expect(out.phones).toEqual(["+16145550132"]);
  });

  it("extracts about text from body paragraphs, not boilerplate", () => {
    expect(out.about).toContain("honest, upfront pricing");
    expect(out.about).not.toMatch(/all rights reserved/i);
  });

  it("detects tech-stack hints", () => {
    expect(out.techStack).toEqual(expect.arrayContaining(["WordPress", "Google Analytics"]));
  });

  it("collects social profile links but only same-site follow-up pages", () => {
    expect(out.socials.facebook).toBe("https://www.facebook.com/acmeplumbing");
    expect(out.nextLinks).toEqual(expect.arrayContaining(["https://acme.test/about-us", "https://acme.test/contact"]));
    expect(out.nextLinks.some((l) => l.includes("other.com"))).toBe(false);
  });

  it("falls back to the meta description when there is no body copy", () => {
    const r = extractFromHtml('<html><head><meta name="description" content="Only meta text here."></head><body></body></html>', "https://x.test/");
    expect(r.about).toBe("Only meta text here.");
  });
});

function domainWith(behavior: "ok" | "robots_block" | "unreachable") {
  for (let i = 0; i < 1000; i++) {
    const d = `site-${i}.example`;
    if (siteBehavior(d) === behavior) return d;
  }
  throw new Error("no domain found");
}

const cfg = { userAgent: "LeadLensBot/1.0 (+https://example.com/bot)", delayMs: 0 };
const leadFor = (domain: string) => ({
  name: "Acme Plumbing",
  domain,
  industry: "Plumbing",
  location: "Columbus, OH",
  description: "Acme Plumbing provides emergency plumbing in Columbus, OH. Family-owned and operated for three generations. Serving the area since 1987.",
  foundedYear: 1987,
  phone: "(614) 555-0132",
  email: `info@${domain}`,
});

describe("crawlSite against the synthetic site", () => {
  it("extracts contacts, about text and sources from a normal site", async () => {
    const domain = domainWith("ok");
    const out = await crawlSite(domain, new SyntheticFetcher(leadFor(domain)), new NoopRateLimiter(), cfg);
    expect(out.error).toBeNull();
    expect(out.robotsAllowed).toBe(true);
    expect(out.emails.map((e) => e.address)).toContain(`info@${domain}`);
    expect(out.phones).toContain("+16145550132");
    expect(out.about).toContain("Family-owned");
    expect(out.sourceUrls.length).toBeGreaterThanOrEqual(2);
    expect(out.sourceUrls.every((u) => u.includes(domain))).toBe(true);
    expect(out.socials.facebook).toBeTruthy();
  });

  it("stops without fetching pages when robots.txt disallows crawling", async () => {
    const domain = domainWith("robots_block");
    const inner = new SyntheticFetcher(leadFor(domain));
    const get = vi.spyOn(inner, "get");
    const out = await crawlSite(domain, inner, new NoopRateLimiter(), cfg);
    expect(out.robotsAllowed).toBe(false);
    expect(out.error).toMatch(/robots/i);
    expect(out.sourceUrls).toEqual([]);
    const fetched = get.mock.calls.map(([u]) => new URL(u).pathname);
    expect(fetched.every((p) => p === "/robots.txt")).toBe(true);
  });

  it("reports unreachable sites without throwing", async () => {
    const domain = domainWith("unreachable");
    const out = await crawlSite(domain, new SyntheticFetcher(leadFor(domain)), new NoopRateLimiter(), cfg);
    expect(out.error).toBeTruthy();
    expect(out.emails).toEqual([]);
  });

  it("asks the rate limiter for a slot before every request", async () => {
    const domain = domainWith("ok");
    const calls: [string, number][] = [];
    await crawlSite(
      domain,
      new SyntheticFetcher(leadFor(domain)),
      { acquire: async (host, delay) => void calls.push([host, delay]) },
      { ...cfg, delayMs: 1500 },
    );
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every(([host, delay]) => host === domain && delay >= 1500)).toBe(true);
  });
});

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.4.4", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"])("treats %s as private", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("treats %s as public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it("rejects private literals and non-http protocols", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toBeInstanceOf(FetchError);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toBeInstanceOf(FetchError);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(FetchError);
    await expect(assertPublicUrl("http://93.184.216.34/")).resolves.toBeInstanceOf(URL);
  });
});

describe("HttpFetcher retries and backoff", () => {
  afterEach(() => vi.unstubAllGlobals());
  const make = (sleeps: number[] = []) =>
    new HttpFetcher({ userAgent: "LeadLensBot/1.0", timeoutMs: 1000, retries: 2, baseBackoffMs: 100, sleep: async (ms) => void sleeps.push(ms) });

  it("retries 5xx with exponential backoff and returns the eventual success", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response("down", { status: 502 }))
      .mockResolvedValueOnce(new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await make(sleeps).get("http://93.184.216.34/");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it("sends our User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await make().get("http://93.184.216.34/");
    expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toBe("LeadLensBot/1.0");
  });

  it("does not retry 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await make().get("http://93.184.216.34/missing");
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries on network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(make().get("http://93.184.216.34/")).rejects.toThrow(/Network error/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refuses to follow a redirect to another domain", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { location: "http://8.8.8.8/" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(make().get("http://93.184.216.34/")).rejects.toThrow(/different domain/);
  });
});
