// Shared route plumbing: auth, rate limit, JSON parsing, numeric ids. Authorisation is ALWAYS server-side.
import { NextResponse } from "next/server";
import { currentUser, type AppUser } from "@/lib/users";
import { rateLimit, rateLimitUser, type LIMITS } from "@/lib/rate-limit";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const err = (error: string, status: number, message?: string) => json({ error, ...(message ? { message } : {}) }, status);

export async function guard(req: Request, limit: keyof typeof LIMITS = "read"): Promise<{ user: AppUser } | { res: NextResponse }> {
  const limited = rateLimit(req, limit);
  if (limited) return { res: limited };
  let user: AppUser | null = null;
  try {
    user = await currentUser();
  } catch {
    return { res: err("server_error", 500, "Something went wrong. Please try again.") };
  }
  if (!user) return { res: err("no_profile", 401) };
  const perUser = rateLimitUser(user.id, limit);
  if (perUser) return { res: perUser };
  return { user };
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 300_000): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as T) : null;
  } catch {
    return null;
  }
}

export const toId = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? n : null;
};

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
