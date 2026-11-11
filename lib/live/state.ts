// The app's connection state, split into independent layers so one failing layer can never be reported as another:
//
//   browser   the device has (or lacks) a network connection          navigator.onLine + online/offline events
//   api       Jyntra's own server answers its heartbeat               /api/live
//   refresh   the background data refresh                             running / failed / ok, with the last good time
//   sources   each provider (Himalayas, funding feeds, ...)           reported by the server, shown per source
//
// "Offline" is shown ONLY when the browser itself is offline. A 429 or 5xx from /api/live is "busy"; a dropped request while the
// browser is online is "can't reach Jyntra". A failing provider is a per-source notice. Pure functions: no DOM, no timers.

export type ApiHealth = "unknown" | "ok" | "busy" | "unreachable";
export type RefreshState = "idle" | "refreshing" | "failed";

/** What /api/live returns. Every field the client reads is listed here. */
export interface LiveReply {
  version: string;
  discovery: { running: boolean; finishedAt: string | null };
  news: { refreshing: boolean; checkedAt: string | null };
  /** Server's own view of the last background refresh. */
  refresh?: { state: RefreshState; lastSuccessAt: string | null; lastFailureAt: string | null };
  /** true only when the data on screen is the previous successful copy because the latest refresh failed. */
  servingCache?: boolean;
  /** How many providers currently need attention (details come from /api/sources/status). */
  sourcesNeedingAttention?: number;
}

export interface LiveState {
  /** false until the first answer (or the first browser event) arrives */
  ready: boolean;
  browserOnline: boolean;
  api: ApiHealth;
  /** when the next automatic check is due after a failure (epoch ms), for "retrying in…" text */
  retryAt: number | null;
  refresh: RefreshState;
  servingCache: boolean;
  sourcesNeedingAttention: number;
  discoveryAt: string | null;
  newsAt: string | null;
  /** newest successful refresh of either, the timestamp the UI shows */
  lastRefreshAt: string | null;
  /** consecutive failed heartbeats; drives backoff */
  failures: number;
  /** changes whenever a refresh finished; pages reload their data when it changes */
  version: string | null;
}

export const initialState = (browserOnline = true): LiveState => ({
  ready: false,
  browserOnline,
  api: "unknown",
  retryAt: null,
  refresh: "idle",
  servingCache: false,
  sourcesNeedingAttention: 0,
  discoveryAt: null,
  newsAt: null,
  lastRefreshAt: null,
  failures: 0,
  version: null,
});

export type PollResult =
  | { kind: "ok"; reply: LiveReply }
  /** The server answered, but not with success. 401 = no profile yet (not a fault). */
  | { kind: "http"; status: number; retryAfterSeconds?: number }
  /** No answer at all: connection dropped, DNS, timeout, CORS. */
  | { kind: "network" };

const newest = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

export function applyBrowser(s: LiveState, online: boolean): LiveState {
  // Going offline blames nothing else. Coming back resets the failure streak so the first re-check is prompt, not backed off.
  return { ...s, ready: true, browserOnline: online, failures: online && !s.browserOnline ? 0 : s.failures, retryAt: online ? s.retryAt : null };
}

export function applyPoll(s: LiveState, r: PollResult, now: number, browserOnline: boolean): LiveState {
  const base = { ...s, ready: true, browserOnline };
  if (r.kind === "ok") {
    const d = r.reply;
    const refresh: RefreshState = d.discovery.running || d.news.refreshing ? "refreshing" : d.refresh?.state === "failed" ? "failed" : "idle";
    return {
      ...base,
      api: "ok",
      retryAt: null,
      failures: 0,
      refresh,
      // Only claim cached data when the server says so AND there is a last good time to point at.
      servingCache: !!d.servingCache && !!(d.refresh?.lastSuccessAt ?? newest(d.discovery.finishedAt, d.news.checkedAt)),
      sourcesNeedingAttention: d.sourcesNeedingAttention ?? 0,
      discoveryAt: d.discovery.finishedAt,
      newsAt: d.news.checkedAt,
      lastRefreshAt: d.refresh?.lastSuccessAt ?? newest(d.discovery.finishedAt, d.news.checkedAt),
      version: d.version,
    };
  }
  if (r.kind === "http") {
    if (r.status === 401) return { ...base, api: s.api === "unknown" ? "ok" : s.api, failures: 0, retryAt: null }; // not signed in yet: nothing to keep live
    const failures = s.failures + 1;
    return { ...base, api: "busy", failures, retryAt: now + backoffMs(failures, r.retryAfterSeconds, 0.5) };
  }
  // network failure. If the browser itself is offline that is the explanation; do not also blame the server.
  if (!browserOnline) return { ...base, retryAt: null };
  const failures = s.failures + 1;
  return { ...base, api: "unreachable", failures, retryAt: now + backoffMs(failures, undefined, 0.5) };
}

export const POLL_RUNNING_MS = 5_000;
export const POLL_IDLE_MS = 30_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;

/** Bounded exponential backoff with jitter: 5 s, 10 s, 20 s, 40 s, then 60 s. A server Retry-After is honoured (capped at 5 min). */
export function backoffMs(failures: number, retryAfterSeconds: number | undefined, rand: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  const jittered = Math.round(exp * (0.75 + 0.5 * rand));
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) return Math.max(jittered, Math.min(retryAfterSeconds, 300) * 1000);
  return jittered;
}

/** Milliseconds until the next heartbeat, or null when none should be scheduled (browser offline or tab hidden). */
export function nextPollDelayMs(s: LiveState, now: number, visible: boolean): number | null {
  if (!visible || !s.browserOnline) return null; // resumes on the visibilitychange / online event
  if (s.api === "busy" || s.api === "unreachable") return Math.max(1_000, (s.retryAt ?? now) - now);
  return s.refresh === "refreshing" ? POLL_RUNNING_MS : POLL_IDLE_MS;
}

/** True when pages should reload their data: a refresh finished, or we just recovered from a failure. */
export function shouldReload(prev: LiveState, next: LiveState): boolean {
  const recovered = next.api === "ok" && prev.ready && (prev.api === "busy" || prev.api === "unreachable");
  const reconnected = next.browserOnline && !prev.browserOnline && next.api === "ok";
  const refreshed = prev.version !== null && next.version !== null && prev.version !== next.version;
  return recovered || reconnected || refreshed;
}

export type Banner =
  | { kind: "none" }
  | { kind: "browser_offline"; text: string }
  | { kind: "api_unreachable"; text: string }
  | { kind: "api_busy"; text: string };

/** The single top-level notice. Provider problems are NOT here: they are per-source (see sourceNotices). */
export function connectionBanner(s: LiveState): Banner {
  if (!s.ready) return { kind: "none" };
  if (!s.browserOnline) return { kind: "browser_offline", text: "You're offline. What you see was loaded earlier; it updates when your connection returns." };
  if (s.api === "unreachable") return { kind: "api_unreachable", text: "Can't reach Jyntra right now. Retrying automatically." };
  if (s.api === "busy") return { kind: "api_busy", text: "Jyntra is busy. Retrying automatically." };
  return { kind: "none" };
}

/** One line about the data itself: refreshing, cached after a failed refresh, or live. Never claims cache unless cache is in use. */
export function dataLine(s: LiveState, now: number): { tone: "live" | "updating" | "cached" | "none"; text: string } {
  if (!s.ready || s.api === "unknown" || !s.lastRefreshAt) return s.refresh === "refreshing" ? { tone: "updating", text: "Updating now…" } : { tone: "none", text: "" };
  const at = ago(s.lastRefreshAt, now);
  if (s.refresh === "refreshing") return { tone: "updating", text: `Updating… last update ${at}` };
  if (s.servingCache || s.refresh === "failed") return { tone: "cached", text: `Showing data from ${at}. The latest update did not finish; it will be retried.` };
  return { tone: "live", text: `Updated ${at}` };
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const m = Math.max(0, (now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  return h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}
