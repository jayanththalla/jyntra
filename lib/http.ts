// Polite HTTP: robots.txt check, per-host rate limit, timeout, and a small disk cache.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { settings } from "@/config/settings";

const CACHE_DIR = path.join(process.cwd(), ".cache", "http");
const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { disallow: string[]; allow: string[] } | null>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(host: string) {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + settings.perHostDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

function parseRobots(txt: string) {
  // Only the `User-agent: *` group is honoured (we don't claim a named agent).
  const out = { disallow: [] as string[], allow: [] as string[] };
  let inStar = false;
  let sawRuleInGroup = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (sawRuleInGroup) {
        inStar = false;
        sawRuleInGroup = false;
      }
      if (val === "*") inStar = true;
    } else if (key === "disallow" || key === "allow") {
      sawRuleInGroup = true;
      if (inStar && val) (key === "allow" ? out.allow : out.disallow).push(val);
    }
  }
  return out;
}

function ruleMatches(rule: string, p: string) {
  const re = new RegExp(
    "^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")
  );
  return re.test(p);
}

export async function robotsAllowed(url: string): Promise<boolean> {
  const u = new URL(url);
  const key = u.origin;
  if (!robotsCache.has(key)) {
    try {
      const txt = await cachedText(`${u.origin}/robots.txt`, settings.cacheHours.robots, { skipRobots: true });
      robotsCache.set(key, parseRobots(txt));
    } catch {
      robotsCache.set(key, null); // no robots.txt → allowed
    }
  }
  const rules = robotsCache.get(key);
  if (!rules) return true;
  const p = u.pathname + u.search;
  const longest = (list: string[]) =>
    list.filter((r) => ruleMatches(r, p)).reduce((a, r) => Math.max(a, r.length), -1);
  return longest(rules.allow) >= longest(rules.disallow);
}

/** Why a provider request failed, in terms the UI and health records can use. Never contains a URL, key or response body. */
export type ErrorCategory = "timeout" | "rate_limited" | "server_error" | "client_error" | "blocked" | "network" | "bad_response" | "disabled";

export function categoryFromStatus(status: number | undefined): ErrorCategory {
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status && status >= 500) return "server_error";
  if (status === 401 || status === 403) return "blocked";
  return "client_error";
}

export class FetchError extends Error {
  public category: ErrorCategory;
  /** Seconds the provider asked us to wait (Retry-After), when it said so. */
  public retryAfterSeconds?: number;
  constructor(message: string, public status?: number, category?: ErrorCategory, retryAfterSeconds?: number) {
    super(message);
    this.category = category ?? (status ? categoryFromStatus(status) : "network");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Best-effort category for any thrown value. */
export function errorCategory(e: unknown): ErrorCategory {
  if (e instanceof FetchError) return e.category;
  const m = (e as Error)?.message ?? "";
  if (/abort|timeout|timed out/i.test(m)) return "timeout";
  return "network";
}

/** Statuses worth retrying: rate limited or a temporary server problem. 4xx such as 403/404 are final. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Parses Retry-After as seconds or as an HTTP date. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - now) / 1000));
}

export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const asSeconds = parseRetryAfter(retryAfter);
  if (asSeconds !== undefined) return Math.min(asSeconds, 10) * 1000; // honour Retry-After, capped
  return Math.min(1000 * 3 ** attempt, 9000) + Math.floor(Math.random() * 250); // 1s, 3s, 9s (+ jitter)
}

export async function politeFetch(url: string, opts: { skipRobots?: boolean; headers?: Record<string, string>; retries?: number; method?: string; body?: string } = {}) {
  if (!opts.skipRobots && !(await robotsAllowed(url))) {
    throw new FetchError(`Blocked by robots.txt: ${url}`, undefined, "blocked");
  }
  const host = new URL(url).host;
  const retries = opts.retries ?? settings.retries;
  let last: FetchError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), settings.requestTimeoutMs);
    let wait = 0;
    try {
      const res = await fetch(url, {
        method: opts.method,
        body: opts.body,
        headers: { "User-Agent": settings.userAgent, Accept: "*/*", ...opts.headers },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (res.ok) return res;
      last = new FetchError(`HTTP ${res.status} for ${url}`, res.status, undefined, parseRetryAfter(res.headers.get("retry-after")));
      if (!RETRYABLE.has(res.status)) throw last;
      wait = retryDelayMs(attempt, res.headers.get("retry-after"));
    } catch (e) {
      if (e instanceof FetchError && !RETRYABLE.has(e.status ?? 0)) throw e;
      last = e instanceof FetchError ? e : new FetchError(`Fetch failed for ${url}: ${(e as Error).message}`, undefined, ctrl.signal.aborted ? "timeout" : "network");
      wait = retryDelayMs(attempt, null);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(wait);
  }
  throw last ?? new FetchError(`Fetch failed for ${url}`);
}

function cachePath(url: string) {
  return path.join(CACHE_DIR, crypto.createHash("sha1").update(url).digest("hex"));
}

/** Hours since this URL was last fetched, or null if never. */
export function cacheAgeHours(url: string): number | null {
  try {
    return (Date.now() - fs.statSync(cachePath(url)).mtimeMs) / 3600_000;
  } catch {
    return null;
  }
}

export function isCached(url: string, maxAgeHours: number): boolean {
  try {
    return Date.now() - fs.statSync(cachePath(url)).mtimeMs < maxAgeHours * 3600_000;
  } catch {
    return false;
  }
}

export interface CachedResult {
  body: string;
  /** "fresh" = cache hit inside the lifetime; "network" = just fetched; "stale" = the network failed and an OLD copy was returned. */
  from: "fresh" | "network" | "stale";
  /** When this body was last fetched successfully from the provider (file mtime), as ISO text. */
  fetchedAt: string;
  /** Set when from === "stale": why the refresh failed. */
  error?: { category: ErrorCategory; retryAfterSeconds?: number };
}

/**
 * GET text with a disk cache. Unlike cachedText it tells the caller whether the body is fresh or an old copy, so a health
 * record can say "serving cache from <time>" instead of pretending the provider answered. `validate` runs on every NEW
 * body BEFORE it is cached: a 200 response that is really an error page is never stored, so it can't poison later reads.
 * With `allowStale: false` a failed refresh throws instead of returning the old copy.
 */
export async function cachedTextInfo(
  url: string,
  maxAgeHours: number,
  opts: { skipRobots?: boolean; headers?: Record<string, string>; retries?: number; validate?: (body: string) => void; allowStale?: boolean } = {}
): Promise<CachedResult> {
  const file = cachePath(url);
  let stale: { body: string; at: number } | null = null;
  try {
    const st = fs.statSync(file);
    const body = fs.readFileSync(file, "utf8");
    if (Date.now() - st.mtimeMs < maxAgeHours * 3600_000) return { body, from: "fresh", fetchedAt: new Date(st.mtimeMs).toISOString() };
    stale = { body, at: st.mtimeMs };
  } catch {}
  try {
    const res = await politeFetch(url, opts);
    const body = await res.text();
    try {
      opts.validate?.(body);
    } catch (e) {
      throw new FetchError(`Unexpected response shape from ${new URL(url).host}: ${(e as Error).message}`, undefined, "bad_response");
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, body);
    return { body, from: "network", fetchedAt: new Date().toISOString() };
  } catch (e) {
    const robots = e instanceof FetchError && /robots/.test(e.message);
    if (stale !== null && opts.allowStale !== false && !robots) {
      return {
        body: stale.body,
        from: "stale",
        fetchedAt: new Date(stale.at).toISOString(),
        error: { category: errorCategory(e), retryAfterSeconds: e instanceof FetchError ? e.retryAfterSeconds : undefined },
      };
    }
    throw e;
  }
}

/** GET text with a disk cache (maxAgeHours). Stale cache is used if the network fails. */
export async function cachedText(
  url: string,
  maxAgeHours: number,
  opts: { skipRobots?: boolean; headers?: Record<string, string> } = {}
): Promise<string> {
  return (await cachedTextInfo(url, maxAgeHours, opts)).body;
}

export async function cachedJson<T = any>(url: string, maxAgeHours: number, opts: { headers?: Record<string, string> } = {}): Promise<T> {
  // Parsed BEFORE it is cached, so an HTML error page served with 200 is never stored.
  const r = await cachedTextInfo(url, maxAgeHours, { ...opts, validate: (b) => void JSON.parse(b) });
  return JSON.parse(r.body) as T;
}
