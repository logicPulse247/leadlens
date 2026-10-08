import "@/server/polyfills";
import * as cheerio from "cheerio";
import { normalizePhone } from "@/server/services/validation/phone";

export interface Extracted {
  emails: string[];
  phones: string[];
  socials: Record<string, string>;
  about: string | null;
  techStack: string[];
  /** Same-site candidates for secondary pages worth fetching (contact, about). */
  nextLinks: string[];
}

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

const JUNK_EMAIL_DOMAINS = new Set(["example.com", "sentry.io", "wixpress.com", "domain.com", "email.com", "yourdomain.com"]);
const FILE_LIKE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

const SOCIAL_HOSTS: [string, RegExp][] = [
  ["facebook", /(^|\.)facebook\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["twitter", /(^|\.)(twitter|x)\.com$/],
  ["youtube", /(^|\.)youtube\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["yelp", /(^|\.)yelp\.com$/],
  // LinkedIn URLs are recorded only as links the company itself publishes; they are never fetched.
  ["linkedin", /(^|\.)linkedin\.com$/],
];

const TECH_SIGNATURES: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes|wordpress/i],
  ["Wix", /wixstatic|parastorage|wix\.com/i],
  ["Squarespace", /squarespace/i],
  ["Shopify", /cdn\.shopify|shopify/i],
  ["Webflow", /webflow/i],
  ["GoDaddy Website Builder", /godaddy|secureserver\.net/i],
  ["Google Analytics", /google-analytics\.com|googletagmanager\.com\/gtag|gtag\(/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
  ["Facebook Pixel", /connect\.facebook\.net|fbq\(/i],
  ["HubSpot", /hs-scripts|hubspot/i],
  ["Mailchimp", /mailchimp|chimpstatic/i],
  ["Calendly", /calendly/i],
  ["Stripe", /js\.stripe\.com/i],
  ["ServiceTitan", /servicetitan/i],
  ["Housecall Pro", /housecallpro/i],
  ["Jobber", /getjobber|jobber\.com/i],
  ["Podium", /podium\.com|podium-webchat/i],
];

function textOf($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): string {
  return $(el).text().replace(/\s+/g, " ").trim();
}

export function extractFromHtml(html: string, pageUrl: string): Extracted {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);

  const emails = new Set<string>();
  $('a[href^="mailto:" i]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const addr = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (addr) emails.add(addr);
  });

  const phones = new Set<string>();
  $('a[href^="tel:" i]').each((_, el) => {
    const n = normalizePhone(($(el).attr("href") ?? "").replace(/^tel:/i, ""));
    if (n) phones.add(n);
  });

  const socials: Record<string, string> = {};
  const nextLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) return;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    const host = u.hostname.toLowerCase();
    for (const [name, re] of SOCIAL_HOSTS) {
      if (re.test(host) && !socials[name] && u.pathname.length > 1) socials[name] = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
    }
    if (host.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
      const label = `${u.pathname} ${$(el).text()}`.toLowerCase();
      if (/contact|about/.test(label) && u.pathname !== base.pathname) nextLinks.add(`${u.origin}${u.pathname}`);
    }
  });

  const techBlob = $("script[src], link[href], meta[name=generator], img[src]")
    .map((_, el) => `${$(el).attr("src") ?? ""} ${$(el).attr("href") ?? ""} ${$(el).attr("content") ?? ""}`)
    .get()
    .join(" ") + " " + $("script:not([src])").map((_, el) => $(el).html() ?? "").get().join(" ").slice(0, 20000);
  const techStack = TECH_SIGNATURES.filter(([, re]) => re.test(techBlob)).map(([name]) => name);

  const meta = ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim();
  $("script, style, noscript, svg, iframe").remove();
  const fullText = textOf($, $("body")[0] ?? $.root()[0]);
  for (const m of fullText.matchAll(EMAIL_IN_TEXT)) emails.add(m[0].toLowerCase());
  for (const m of fullText.matchAll(PHONE_IN_TEXT)) {
    const n = normalizePhone(m[0]);
    if (n) phones.add(n);
  }

  $("nav, header, footer, form").remove();
  const paragraphs = $("p")
    .map((_, el) => textOf($, el))
    .get()
    .filter((t) => t.length >= 40 && !/^©|all rights reserved/i.test(t));
  const about = (paragraphs.join(" ") || meta || null)?.slice(0, 900) ?? null;

  const cleanEmails = [...emails].filter((e) => {
    const domain = e.split("@")[1] ?? "";
    return !FILE_LIKE.test(e) && !JUNK_EMAIL_DOMAINS.has(domain);
  });

  return {
    emails: cleanEmails,
    phones: [...phones],
    socials,
    about,
    techStack,
    nextLinks: [...nextLinks].slice(0, 2),
  };
}
