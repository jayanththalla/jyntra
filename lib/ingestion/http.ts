// The only place the ingestion engine touches the network. Adds what the generic politeFetch in lib/http.ts does not:
// conditional requests, a response-size cap, bot-challenge detection, Retry-After, redirect re-validation, and a
// replaceable fetch so tests never need the internet.
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/net/public-url";
import { IngestError, type IngestErrorCategory } from "./types";

/** Request accounting so an operator can measure volume and duration of a sample before scaling a run up. */
export const httpStats = { requests: 0, bytes: 0, byStatus: {} as Record<string, number> };
export function resetHttpStats() { httpStats.requests = 0; httpStats.bytes = 0; httpStats.byStatus = {}; }

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let impl: FetchLike = (url, init) => fetch(url, init);
/** Tests install a fixture-backed fetch here. Returns the previous one. */
export function setFetchImpl(fn: FetchLike | null): FetchLike {
  const prev = impl;
  impl = fn ?? ((url, init) => fetch(url, init));
  return prev;
}

export const USER_AGENT = process.env.JOB_INGESTION_USER_AGENT || "JyntraBot/1.0 (+job-board ingestion; public employer feeds only)";
export const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_PROVIDER_TIMEOUT_MS) > 0 ? Number(process.env.JOB_PROVIDER_TIMEOUT_MS) : 20_000;
export const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface HttpOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: unknown; // JSON-serialised when present
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface HttpResult {
  status: number;
  notModified: boolean;
  text: string;
  etag: string | null;
  lastModified: string | null;
  contentType: string;
}

export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 24 * 3600);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.min(Math.max(0, Math.ceil((t - now) / 1000)), 24 * 3600);
}

const CHALLENGE_BODY = /just a moment|cf-chl|cf_chl|attention required|captcha|access denied|enable javascript and cookies/i;

export function classifyStatus(status: number, headers: Headers, bodySnippet = ""): IngestErrorCategory {
  if (headers.get("cf-mitigated") === "challenge") return "challenge";
  if ((status === 403 || status === 503 || status === 429) && CHALLENGE_BODY.test(bodySnippet.slice(0, 2000))) return "challenge";
  if (status === 429) return "rate_limited";
  if (status === 404 || status === 410) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server_error";
  if (status === 401 || status === 403) return "blocked";
  return "client_error";
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new IngestError(`response larger than ${maxBytes} bytes`, "too_large", res.status);
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new IngestError(`response larger than ${maxBytes} bytes`, "too_large", res.status);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One HTTP exchange. Throws IngestError for anything that is not a usable 200/304. Never retries (the scheduler owns that). */
export async function httpRequest(url: string, o: HttpOptions = {}): Promise<HttpResult> {
  let current = url;
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublicHttpsUrl(current);
    } catch (e) {
      // A host that does not resolve is a network condition (outage, blocked egress, or a dead tenant), not an unsafe destination.
      if (e instanceof UnsafeUrlError && e.kind === "dns") throw new IngestError("DNS: host did not resolve", "network");
      throw new IngestError(e instanceof UnsafeUrlError ? e.message : "unsafe URL", "unsafe_url");
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const onAbort = () => ctrl.abort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json, text/xml;q=0.9, */*;q=0.5", ...o.headers };
      if (o.body !== undefined) headers["Content-Type"] ??= "application/json";
      if (o.etag) headers["If-None-Match"] = o.etag;
      if (o.lastModified) headers["If-Modified-Since"] = o.lastModified;
      const res = await impl(current, {
        method: o.method ?? "GET",
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: ctrl.signal,
        redirect: "manual",
      });
      httpStats.requests++;
      httpStats.byStatus[String(res.status)] = (httpStats.byStatus[String(res.status)] ?? 0) + 1;
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get("location");
        if (!loc) throw new IngestError(`redirect without location (HTTP ${res.status})`, "bad_response", res.status);
        current = new URL(loc, current).toString(); // re-validated at the top of the loop
        continue;
      }
      if (res.status === 304) {
        return { status: 304, notModified: true, text: "", etag: res.headers.get("etag") ?? o.etag ?? null, lastModified: res.headers.get("last-modified") ?? o.lastModified ?? null, contentType: "" };
      }
      if (!res.ok) {
        const snippet = await readCapped(res, 4096).catch(() => "");
        throw new IngestError(`HTTP ${res.status}`, classifyStatus(res.status, res.headers, snippet), res.status, parseRetryAfter(res.headers.get("retry-after")));
      }
      const text = o.method === "HEAD" ? "" : await readCapped(res, o.maxBytes ?? DEFAULT_MAX_BYTES);
      httpStats.bytes += text.length;
      return { status: res.status, notModified: false, text, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), contentType: res.headers.get("content-type") ?? "" };
    } catch (e) {
      if (e instanceof IngestError) throw e;
      const aborted = ctrl.signal.aborted || (e as Error)?.name === "AbortError";
      throw new IngestError(aborted ? "request timed out" : `network error: ${(e as Error).message}`.slice(0, 200), aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new IngestError("too many redirects", "bad_response");
}

/** JSON helper: a 200 whose body is HTML (error page, login wall) is an error, not "no jobs". */
export async function httpJson<T = unknown>(url: string, o: HttpOptions = {}): Promise<{ notModified: boolean; status: number; data: T | null; etag: string | null; lastModified: string | null }> {
  const r = await httpRequest(url, o);
  if (r.notModified) return { notModified: true, status: 304, data: null, etag: r.etag, lastModified: r.lastModified };
  const head = r.text.trimStart().slice(0, 1);
  if (head !== "{" && head !== "[") {
    throw new IngestError(CHALLENGE_BODY.test(r.text.slice(0, 2000)) ? "bot challenge page instead of JSON" : "response was not JSON", CHALLENGE_BODY.test(r.text.slice(0, 2000)) ? "challenge" : "invalid_json", r.status);
  }
  try {
    return { notModified: false, status: r.status, data: JSON.parse(r.text) as T, etag: r.etag, lastModified: r.lastModified };
  } catch {
    throw new IngestError("invalid JSON", "invalid_json", r.status);
  }
}

/** Seconds to wait before the next try, given consecutive failures. Exponential, capped, with jitter. */
export function backoffSeconds(consecutiveFailures: number, retryAfterSeconds?: number, rnd: () => number = Math.random): number {
  const exp = Math.min(60 * 2 ** Math.max(0, consecutiveFailures - 1), 12 * 3600);
  const base = Math.max(exp, retryAfterSeconds ?? 0);
  return Math.round(base * (1 + 0.2 * rnd())); // +0..20 % jitter
}
