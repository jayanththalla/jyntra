// Starts "Sign in with Google": sets a signed, short-lived ticket cookie (state + PKCE verifier + nonce) and redirects to Google.
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeUrl, googleLoginConfigured, LOGIN_COOKIE, newTicket, packTicket, redirectUri } from "@/lib/auth/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleLoginConfigured()) return NextResponse.redirect(new URL("/login?error=not_configured", url.origin), 303);
  const limited = rateLimit(req, "privateLink");
  if (limited) return limited;
  const ticket = newTicket(url.searchParams.get("next"));
  const res = NextResponse.redirect(authorizeUrl({ clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri: redirectUri(url.origin), ticket }), 303);
  res.cookies.set(LOGIN_COOKIE, packTicket(ticket), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 });
  return res;
}
