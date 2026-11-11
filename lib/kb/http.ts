// HTTP for connectors: timeout, retry with backoff, Retry-After, and typed errors. Tokens only ever go in headers.
import { SourceError } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KbFetchOpts {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  method?: string;
  body?: string;
}

/** Returns the Response for 2xx; throws SourceError otherwise. Never includes the URL's query or headers in errors. */
export async function kbFetch(url: string, o: KbFetchOpts = {}): Promise<Response> {
  const f = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 2;
  const wait = o.sleepFn ?? sleep;
  let last: SourceError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, { method: o.method, body: o.body, headers: o.headers, signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
      if (res.ok) return res;
      if (res.status === 401) throw new SourceError("unauthorized", "The provider rejected the credentials.");
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const ra = Number(res.headers.get("retry-after"));
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const limited = res.status === 429 || remaining === "0" || ra > 0;
        if (!limited) throw new SourceError("unauthorized", "Access to this resource is not permitted.");
        const ms = ra > 0 ? ra * 1000 : reset > 0 ? Math.max(1000, reset * 1000 - Date.now()) : 2000 * (attempt + 1);
        last = new SourceError("rate_limited", "The provider's rate limit was reached.", ms);
        if (attempt < retries && ms <= 10_000) {
          await wait(ms);
          continue;
        }
        throw last;
      }
      if (res.status === 404) throw new SourceError("not_found", "Not found or not accessible.");
      last = new SourceError("unavailable", `The provider answered HTTP ${res.status}.`);
      if (res.status >= 500 && attempt < retries) {
        await wait(500 * 2 ** attempt);
        continue;
      }
      throw last;
    } catch (e) {
      if (e instanceof SourceError) throw e;
      last = new SourceError("unavailable", (e as Error).name === "TimeoutError" ? "The provider timed out." : "The provider could not be reached.");
      if (attempt < retries) {
        await wait(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw last ?? new SourceError("unavailable", "Request failed.");
}

export async function kbJson<T>(url: string, o: KbFetchOpts = {}): Promise<T> {
  const res = await kbFetch(url, o);
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError("unavailable", "The provider returned an unreadable response.");
  }
}
