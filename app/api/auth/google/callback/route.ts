// Google redirects here. We check state against the signed cookie, exchange the code with the PKCE verifier, verify the ID token
// claims, then start a NEW session (the old one is deleted, so a planted session cookie cannot survive login).
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { exchangeLoginCode, googleLoginConfigured, LOGIN_COOKIE, LoginError, redirectUri, unpackTicket } from "@/lib/auth/google";
import { userForGoogle } from "@/lib/auth/accounts";
import { cookieOptions, createSession, currentUser, endSession, sessionToken, USER_COOKIE } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => {
    const r = NextResponse.redirect(new URL(`/login?error=${code}`, url.origin), 303);
    r.cookies.set(LOGIN_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return r;
  };
  const limited = rateLimit(req, "privateLink");
  if (limited) return fail("rate_limited");
  if (!googleLoginConfigured()) return fail("not_configured");
  if (url.searchParams.get("error")) return fail("denied");
  const ticket = unpackTicket((await cookies()).get(LOGIN_COOKIE)?.value);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!ticket || !code || state.length !== ticket.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(ticket.state))) return fail("state");
  try {
    const identity = await exchangeLoginCode({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, code, redirectUri: redirectUri(url.origin), ticket });
    const current = await currentUser().catch(() => null);
    const { userId, created } = await userForGoogle(identity, current);
    await endSession(await sessionToken());
    const token = await createSession(userId);
    const res = NextResponse.redirect(new URL(created ? "/onboarding" : ticket.next, url.origin), 303);
    res.cookies.set(USER_COOKIE, token, cookieOptions);
    res.cookies.set(LOGIN_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (e) {
    if (!(e instanceof LoginError)) console.error("[auth/google]", (e as Error).message.slice(0, 80));
    return fail(e instanceof LoginError ? e.code : "failed");
  }
}
