// Simple in-memory rate limiting per client IP (sliding window). Good enough for a single
// server instance; if the app ever runs on several instances, move this to the database or Redis.
import { NextResponse } from "next/server";

type Bucket = number[]; // request timestamps (ms)
const store = globalThis as unknown as { __sfRate?: Map<string, Bucket>; __sfRateSweep?: number };
const buckets = (store.__sfRate ??= new Map());

export const LIMITS = {
  createProfile: { max: 5, windowMs: 60 * 60_000 }, // new profiles per IP per hour
  updateProfile: { max: 30, windowMs: 60 * 60_000 },
  resume: { max: 10, windowMs: 60 * 60_000 }, // resume PDF reads per IP per hour
  discover: { max: 20, windowMs: 60 * 60_000 }, // "Find Startups Today" clicks per IP per hour
  privateLink: { max: 30, windowMs: 60 * 60_000 }, // private-link opens (slows token guessing)
  cron: { max: 20, windowMs: 60 * 60_000 }, // refresh triggers per IP per hour (secret is also required)
  send: { max: 15, windowMs: 60 * 60_000 }, // real emails per IP per hour (protects the user's Gmail account)
  emailSend: { max: 12, windowMs: 60 * 60_000 }, // confirmed sends through the email composer per IP per hour
  ai: { max: 20, windowMs: 60 * 60_000 }, // AI generation calls per IP per hour (paid upstream)
  interview: { max: 60, windowMs: 60 * 60_000 }, // mock-interview questions + feedback per IP per hour (paid upstream)
  newLink: { max: 10, windowMs: 60 * 60_000 }, // new private links created
  kbAsk: { max: 40, windowMs: 60 * 60_000 }, // career questions per IP per hour (paid upstream)
  kbSync: { max: 30, windowMs: 60 * 60_000 }, // connects / resyncs per IP per hour
  kbUpload: { max: 40, windowMs: 60 * 60_000 }, // document uploads per IP per hour
  live: { max: 90, windowMs: 60_000 }, // heartbeat: its own bucket, so a busy page can never make the app look unreachable
  voiceSession: { max: 20, windowMs: 60 * 60_000 }, // new voice sessions per IP per hour
  voiceTurn: { max: 120, windowMs: 60 * 60_000 }, // interviewer turns + evaluations (paid upstream)
  voiceStt: { max: 90, windowMs: 60 * 60_000 }, // transcriptions (provider quota)
  voiceRealtime: { max: 30, windowMs: 60 * 60_000 }, // realtime credentials per IP per hour (paid upstream)
  interviewWritten: { max: 120, windowMs: 60 * 60_000 }, // written-test and SQL grading per IP per hour
  interviewPdf: { max: 30, windowMs: 60 * 60_000 }, // PDF renders per IP per hour
  interviewResume: { max: 15, windowMs: 60 * 60_000 }, // interview resume uploads per IP per hour
  voiceTts: { max: 150, windowMs: 60 * 60_000 }, // speech generations (provider quota)
  read: { max: 120, windowMs: 60_000 }, // dashboard/data reads per IP per minute
  write: { max: 60, windowMs: 60_000 }, // saves, status changes, pins per IP per minute
} as const;

/**
 * The client address as seen by OUR proxy. X-Forwarded-For is a list the client can pre-fill, so the FIRST entry is attacker-controlled
 * and must not be trusted. Each trusted proxy appends the address it saw, so with N trusted proxies (TRUSTED_PROXY_HOPS, default 1,
 * which is Render's single load balancer) the real client is the Nth entry from the RIGHT. Set it to 0 when there is no proxy.
 */
export function clientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  const hops = Math.max(0, Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10) || 0);
  const fwd = (req.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (hops > 0 && fwd.length) return fwd[Math.max(0, fwd.length - hops)];
  return (hops === 0 ? "" : req.headers.get("x-real-ip") ?? "").trim() || "unknown";
}

const MAX_BUCKETS = 20_000; // a flood of distinct keys must not grow memory without bound

/** Same limits, keyed by signed-in user, so rotating IP addresses does not bypass a per-account limit. */
export function rateLimitUser(userId: number, name: keyof typeof LIMITS): NextResponse | null {
  return hit(`u${userId}:${name}`, name);
}

/** Returns a 429 response if the client is over the limit, otherwise null (and records the hit). */
export function rateLimit(req: Request, name: keyof typeof LIMITS): NextResponse | null {
  return hit(`${name}:${clientIp(req)}`, name);
}

function hit(key: string, name: keyof typeof LIMITS): NextResponse | null {
  const { max, windowMs } = LIMITS[name];
  const now = Date.now();
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    // Evict the oldest key (Map keeps insertion order) rather than refusing everyone.
    const first = buckets.keys().next().value;
    if (first !== undefined) buckets.delete(first);
  }
  const hits = (buckets.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (hits.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    buckets.set(key, hits);
    const wait = retryAfter >= 120 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`;
    return NextResponse.json(
      { error: `Too many requests — please try again in ${wait}.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  sweep(now);
  return null;
}

/** Drop idle buckets every few minutes so memory doesn't grow. */
function sweep(now: number) {
  if (now - (store.__sfRateSweep ?? 0) < 5 * 60_000) return;
  store.__sfRateSweep = now;
  const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowMs));
  for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > longest) buckets.delete(k);
}
