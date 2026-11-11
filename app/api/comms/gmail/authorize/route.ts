// Starts Gmail OAuth (scope: send only). State is random, HMAC-bound to the signed-in user and kept in a short-lived httpOnly cookie.
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { guard, err } from "@/lib/kb/api";
import { authorizeUrl, gmailOAuthConfigured, signState, STATE_COOKIE } from "@/lib/comms/gmail";
import { vaultConfigured } from "@/lib/secrets/vault";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "kbSync");
  if ("res" in g) return g.res;
  if (!gmailOAuthConfigured() || !vaultConfigured()) return err("not_configured", 503, "Gmail sign-in isn't configured on this server.");
  const url = new URL(req.url);
  const nonce = crypto.randomBytes(18).toString("base64url");
  const state = `${nonce}.${signState(g.user.id, nonce)}`;
  const redirectUri = `${process.env.APP_URL?.replace(/\/$/, "") || url.origin}/api/comms/gmail/callback`;
  const res = NextResponse.redirect(authorizeUrl({ clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri, state }), 307);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/comms/gmail", maxAge: 600 });
  return res;
}
