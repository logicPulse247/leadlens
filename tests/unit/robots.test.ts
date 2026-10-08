import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobots, RobotsService, crawlDelayFor } from "@/server/services/enrichment/robots";

const UA = "LeadLensBot/1.0 (+https://example.com/bot)";

describe("robots.txt parsing and matching", () => {
  it("allows everything when robots.txt is empty", () => {
    expect(isPathAllowed(parseRobots(""), UA, "/anything")).toBe(true);
  });

  it("blocks a fully disallowed site", () => {
    const r = parseRobots("User-agent: *\nDisallow: /");
    expect(isPathAllowed(r, UA, "/")).toBe(false);
    expect(isPathAllowed(r, UA, "/contact")).toBe(false);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow:"), UA, "/x")).toBe(true);
  });

  it("applies path prefixes", () => {
    const r = parseRobots("User-agent: *\nDisallow: /private/\nDisallow: /cart");
    expect(isPathAllowed(r, UA, "/private/data")).toBe(false);
    expect(isPathAllowed(r, UA, "/cart")).toBe(false);
    expect(isPathAllowed(r, UA, "/contact")).toBe(true);
  });

  it("lets the longest matching rule win, and Allow win ties", () => {
    const r = parseRobots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php");
    expect(isPathAllowed(r, UA, "/wp-admin/options.php")).toBe(false);
    expect(isPathAllowed(r, UA, "/wp-admin/admin-ajax.php")).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page");
    expect(isPathAllowed(tie, UA, "/page")).toBe(true);
  });

  it("supports * and $ wildcards", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*?q=");
    expect(isPathAllowed(r, UA, "/files/menu.pdf")).toBe(false);
    expect(isPathAllowed(r, UA, "/files/menu.pdf.html")).toBe(true);
    expect(isPathAllowed(r, UA, "/search/results?q=hvac")).toBe(false);
  });

  it("prefers a group naming our bot over the * group", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: LeadLensBot\nDisallow: /secret";
    const r = parseRobots(text);
    expect(isPathAllowed(r, UA, "/")).toBe(true);
    expect(isPathAllowed(r, UA, "/secret")).toBe(false);
  });

  it("blocks us when our bot is explicitly disallowed", () => {
    const r = parseRobots("User-agent: leadlensbot\nDisallow: /\n\nUser-agent: *\nAllow: /");
    expect(isPathAllowed(r, UA, "/")).toBe(false);
  });

  it("groups consecutive user-agent lines and ignores comments", () => {
    const r = parseRobots("# hi\nUser-agent: googlebot\nUser-agent: leadlensbot # us\nDisallow: /x # nope\n");
    expect(isPathAllowed(r, UA, "/x")).toBe(false);
  });

  it("reads Crawl-delay for our group", () => {
    const r = parseRobots("User-agent: *\nCrawl-delay: 5\nDisallow: /a");
    expect(crawlDelayFor(r, UA)).toBe(5);
  });
});

describe("RobotsService", () => {
  const service = (status: number, body = "") => new RobotsService(UA, async () => ({ status, body }));

  it("allows when robots.txt is missing (404)", async () => {
    expect((await service(404).check("https://acme.test/contact")).allowed).toBe(true);
  });

  it("refuses to crawl when robots.txt is forbidden or the server errors", async () => {
    expect((await service(403).check("https://acme.test/")).allowed).toBe(false);
    expect((await service(503).check("https://acme.test/")).allowed).toBe(false);
  });

  it("reports the reason and crawl delay", async () => {
    const blocked = await service(200, "User-agent: *\nDisallow: /").check("https://acme.test/");
    expect(blocked).toMatchObject({ allowed: false, reason: "Disallowed by robots.txt" });
    const delayed = await service(200, "User-agent: *\nCrawl-delay: 3").check("https://acme.test/");
    expect(delayed.crawlDelayMs).toBe(3000);
  });

  it("caches robots.txt per host", async () => {
    let loads = 0;
    const store = new Map<string, { status: number; body: string }>();
    const svc = new RobotsService(
      UA,
      async () => {
        loads++;
        return { status: 200, body: "User-agent: *\nDisallow: /x" };
      },
      { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) },
    );
    await svc.check("https://acme.test/a");
    await svc.check("https://acme.test/b");
    expect(loads).toBe(1);
  });
});
