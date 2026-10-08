import dns from "node:dns/promises";
import net from "node:net";
import { childLogger } from "@/lib/logger";

const log = childLogger("fetcher");

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface PageFetcher {
  get(url: string): Promise<FetchResult>;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true;
}

/** Blocks SSRF: only public http(s) hosts. Lead domains are user-supplied, so this is not optional. */
export async function assertPublicUrl(url: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new FetchError(`Invalid URL: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError(`Unsupported protocol ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new FetchError("Refusing to fetch a private address");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new FetchError(`DNS lookup failed for ${host} (${code ?? "error"})`, code === "EAI_AGAIN");
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new FetchError("Refusing to fetch a host that resolves to a private address");
  }
  return u;
}

const stripWww = (h: string) => h.replace(/^www\./, "");

export interface HttpFetcherOptions {
  userAgent: string;
  timeoutMs: number;
  retries?: number;
  maxBytes?: number;
  maxRedirects?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polite HTTP client: identifies itself, times out, retries transient failures with
 * exponential backoff + jitter (honoring Retry-After), caps body size, refuses private
 * addresses and cross-domain redirects.
 */
export class HttpFetcher implements PageFetcher {
  private readonly retries: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpFetcherOptions) {
    this.retries = opts.retries ?? 2;
    this.maxBytes = opts.maxBytes ?? 1_000_000;
    this.maxRedirects = opts.maxRedirects ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async get(url: string): Promise<FetchResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.once(url);
        const transient = res.status === 429 || res.status >= 500;
        if (!transient || attempt === this.retries) return res;
        lastError = new FetchError(`HTTP ${res.status}`, true);
        await this.sleep(this.backoff(attempt, res.retryAfterMs));
      } catch (err) {
        lastError = err;
        const retryable = err instanceof FetchError ? err.retryable : true;
        if (!retryable || attempt === this.retries) break;
        log.debug({ url, attempt, err: String(err) }, "retrying fetch");
        await this.sleep(this.backoff(attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new FetchError(String(lastError));
  }

  private backoff(attempt: number, retryAfterMs?: number) {
    const exp = this.baseBackoffMs * 2 ** attempt + Math.random() * 250;
    return Math.min(retryAfterMs ?? exp, 10_000);
  }

  private async once(startUrl: string): Promise<FetchResult & { retryAfterMs?: number }> {
    let current = startUrl;
    const origin = stripWww(new URL(startUrl).hostname);
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const u = await assertPublicUrl(current);
      if (stripWww(u.hostname) !== origin) throw new FetchError(`Redirected to a different domain (${u.hostname}); not following`);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
      try {
        const res = await fetch(u, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": this.opts.userAgent, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          current = new URL(res.headers.get("location")!, u).toString();
          continue;
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const body = await readCapped(res, this.maxBytes);
        return {
          url: u.toString(),
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          body,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        };
      } catch (err) {
        if (err instanceof FetchError) throw err;
        const aborted = (err as Error).name === "AbortError";
        throw new FetchError(aborted ? `Timed out after ${this.opts.timeoutMs}ms` : `Network error: ${(err as Error).message}`, true);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new FetchError("Too many redirects");
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8").slice(0, maxBytes);
}
