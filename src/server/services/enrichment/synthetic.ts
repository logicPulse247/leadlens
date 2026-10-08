import { FetchError, type FetchResult, type PageFetcher } from "./fetcher";

/**
 * Offline fetcher for reserved TLDs (.example/.test/...), which are unresolvable by design.
 * It renders a believable small-business website from the lead's own data so the real
 * extraction, validation and scoring code runs end to end without touching the network.
 *
 * To make the demo honest about failure modes, ~4% of synthetic sites publish a
 * restrictive robots.txt and ~3% are "unreachable", chosen deterministically by domain hash.
 */

export interface SyntheticLead {
  name: string;
  domain: string;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  foundedYear?: number | null;
  phone?: string | null;
  email?: string | null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type SiteBehavior = "ok" | "robots_block" | "unreachable";

export function siteBehavior(domain: string): SiteBehavior {
  const b = hash(domain) % 100;
  if (b < 4) return "robots_block";
  if (b < 7) return "unreachable";
  return "ok";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function html(title: string, description: string, body: string, scripts: string[] = []): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">${scripts.join("")}</head><body>${body}</body></html>`;
}

const PLATFORMS: { generator?: string; script?: string }[] = [
  { generator: "WordPress 6.4", script: '<link rel="stylesheet" href="/wp-content/themes/main/style.css">' },
  { script: '<script src="https://static.parastorage.com/services/wix.js"></script>' },
  { script: '<script src="https://static1.squarespace.com/static/site.js"></script>' },
  { script: '<script src="https://cdn.shopify.com/s/files/theme.js"></script>' },
  { script: '<script src="https://assets.website-files.com/webflow.js"></script>' },
  {},
];

const EXTRAS = [
  '<script async src="https://www.googletagmanager.com/gtag/js?id=G-DEMO"></script>',
  '<script src="//js.hs-scripts.com/123.js"></script>',
  '<script src="https://assets.calendly.com/assets/external/widget.js"></script>',
  '<script src="https://chimpstatic.com/mcjs-connected/js/users/abc.js"></script>',
];

export class SyntheticFetcher implements PageFetcher {
  private readonly behavior: SiteBehavior;
  private readonly h: number;

  constructor(private readonly lead: SyntheticLead) {
    this.behavior = siteBehavior(lead.domain);
    this.h = hash(lead.domain);
  }

  async get(url: string): Promise<FetchResult> {
    if (this.behavior === "unreachable") throw new FetchError(`Connection timed out to ${this.lead.domain}`);
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    const make = (status: number, body: string, contentType = "text/html; charset=utf-8"): FetchResult => ({ url, status, contentType, body });

    if (path === "/robots.txt") {
      if (this.behavior === "robots_block") return make(200, "User-agent: *\nDisallow: /\n", "text/plain");
      if (this.h % 2 === 0) {
        return make(200, "User-agent: *\nDisallow: /wp-admin/\nDisallow: /cart\nAllow: /wp-admin/admin-ajax.php\nSitemap: /sitemap.xml\n", "text/plain");
      }
      return make(404, "Not found", "text/plain");
    }
    if (path === "/") return make(200, this.home());
    if (path === "/contact") return make(200, this.contact());
    if (path === "/about") return make(200, this.about());
    return make(404, html("Not found", "", "<h1>404</h1>"));
  }

  private nav(): string {
    return `<header><nav><a href="/">Home</a> <a href="/about">About us</a> <a href="/contact">Contact</a> <a href="/services">Services</a></nav></header>`;
  }

  private footer(): string {
    const slug = this.lead.domain.split(".")[0];
    const socials = [`<a href="https://www.facebook.com/${slug}">Facebook</a>`];
    if (this.h % 2 === 1) socials.push(`<a href="https://instagram.com/${slug}">Instagram</a>`);
    if (this.h % 3 === 0) socials.push(`<a href="https://www.linkedin.com/company/${slug}">LinkedIn</a>`);
    if (this.h % 4 === 0) socials.push(`<a href="https://www.yelp.com/biz/${slug}">Yelp</a>`);
    return `<footer>${socials.join(" ")}<p>&copy; ${new Date().getFullYear()} ${esc(this.lead.name)}. All rights reserved.</p></footer>`;
  }

  private scripts(): string[] {
    const platform = PLATFORMS[this.h % PLATFORMS.length];
    const out: string[] = [];
    if (platform.generator) out.push(`<meta name="generator" content="${platform.generator}">`);
    if (platform.script) out.push(platform.script);
    out.push(EXTRAS[(this.h >>> 3) % EXTRAS.length]);
    if (this.h % 5 === 0) out.push(EXTRAS[(this.h >>> 5) % EXTRAS.length]);
    return out;
  }

  private home(): string {
    const { name, description, location, industry } = this.lead;
    const about = description ?? `${name} is a ${industry ?? "local"} business${location ? ` serving ${location}` : ""}.`;
    const body = `${this.nav()}<main><h1>${esc(name)}</h1><p>${esc(about)}</p></main>${this.footer()}`;
    return html(`${name} | ${industry ?? "Local business"}${location ? ` in ${location}` : ""}`, about.slice(0, 155), body, this.scripts());
  }

  private about(): string {
    const { name, description, foundedYear } = this.lead;
    const body = `${this.nav()}<main><h1>About ${esc(name)}</h1><p>${esc(description ?? "")}</p>${foundedYear ? `<p>Established in ${foundedYear}.</p>` : ""}</main>${this.footer()}`;
    return html(`About ${name}`, (description ?? name).slice(0, 155), body);
  }

  private contact(): string {
    const { name, phone, email, location } = this.lead;
    const parts: string[] = [`<h1>Contact ${esc(name)}</h1>`];
    if (location) parts.push(`<p>Located in ${esc(location)}</p>`);
    if (phone) parts.push(`<p>Call us: <a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(phone)}</a></p>`);
    if (email) parts.push(`<p>Email: <a href="mailto:${esc(email)}">${esc(email)}</a></p>`);
    return html(`Contact | ${name}`, `Contact ${name}`, `${this.nav()}<main>${parts.join("")}</main>${this.footer()}`);
  }
}
