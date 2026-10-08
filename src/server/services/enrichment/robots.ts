export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
}

/** Parses robots.txt per RFC 9309: consecutive User-agent lines form one group; unknown directives are ignored. */
export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // "Disallow:" with an empty value means "allow everything" and carries no rule.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups };
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const anchored = escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped;
  return new RegExp("^" + anchored);
}

/** Product token of our User-Agent, e.g. "LeadLensBot/1.0 (...)" -> "leadlensbot". */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[\s/]/)[0] ?? "").toLowerCase();
}

function groupsFor(parsed: ParsedRobots, token: string): RobotsGroup[] {
  let bestLen = 0;
  const specific: RobotsGroup[] = [];
  for (const g of parsed.groups) {
    for (const agent of g.agents) {
      if (agent !== "*" && token.includes(agent) && agent.length >= bestLen) {
        if (agent.length > bestLen) specific.length = 0;
        bestLen = agent.length;
        specific.push(g);
        break;
      }
    }
  }
  if (specific.length) return specific;
  return parsed.groups.filter((g) => g.agents.includes("*"));
}

/** Longest matching rule wins; on a tie, Allow beats Disallow. No matching rule means allowed. */
export function isPathAllowed(parsed: ParsedRobots, userAgent: string, path: string): boolean {
  const rules = groupsFor(parsed, productToken(userAgent)).flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export function crawlDelayFor(parsed: ParsedRobots, userAgent: string): number | undefined {
  return groupsFor(parsed, productToken(userAgent)).find((g) => g.crawlDelay !== undefined)?.crawlDelay;
}

export interface RobotsDecision {
  allowed: boolean;
  crawlDelayMs?: number;
  reason?: string;
}

export interface RobotsFile {
  status: number;
  body: string;
}

export type RobotsLoader = (origin: string) => Promise<RobotsFile>;

export interface RobotsCache {
  get(key: string): Promise<RobotsFile | null>;
  set(key: string, value: RobotsFile, ttlSeconds: number): Promise<void>;
}

/**
 * Decides whether a URL may be fetched.
 * 404/410 -> no restrictions. 401/403/5xx -> treated as "do not crawl" (conservative).
 */
export class RobotsService {
  constructor(
    private readonly userAgent: string,
    private readonly load: RobotsLoader,
    private readonly cache?: RobotsCache,
    private readonly ttlSeconds = 6 * 3600,
  ) {}

  async check(url: string): Promise<RobotsDecision> {
    const u = new URL(url);
    const origin = u.origin;
    const key = `robots:${u.host}`;
    let file = (await this.cache?.get(key)) ?? null;
    if (!file) {
      file = await this.load(origin);
      await this.cache?.set(key, file, this.ttlSeconds);
    }
    if (file.status === 404 || file.status === 410) return { allowed: true };
    if (file.status >= 400) return { allowed: false, reason: `robots.txt unavailable (HTTP ${file.status}); not crawling` };
    const parsed = parseRobots(file.body);
    const allowed = isPathAllowed(parsed, this.userAgent, u.pathname + u.search);
    const delay = crawlDelayFor(parsed, this.userAgent);
    return {
      allowed,
      crawlDelayMs: delay !== undefined ? Math.min(delay, 30) * 1000 : undefined,
      reason: allowed ? undefined : "Disallowed by robots.txt",
    };
  }
}
