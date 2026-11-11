// Starts GitHub OAuth. State is random, HMAC-bound to the signed-in user, and stored in a short-lived httpOnly cookie.
import crypto from "node:crypto";
import { STATE_COOKIE, signState } from "@/lib/kb/oauth-state";
import { NextResponse } from "next/server";
import { guard, err } from "@/lib/kb/api";
import { authorizeUrl } from "@/lib/kb/connectors/github";
import { encryptionConfigured } from "@/lib/kb/crypto";

export const dynamic = "force-dynamic";


export async function GET(req: Request) {
  const g = await guard(req, "kbSync");
  if ("res" in g) return g.res;
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id || !process.env.GITHUB_CLIENT_SECRET || !encryptionConfigured()) return err("not_configured", 503, "GitHub sign-in isn't configured on this server.");
  const url = new URL(req.url);
  const nonce = crypto.randomBytes(18).toString("base64url");
  const state = `${nonce}.${signState(g.user.id, nonce)}`;
  const redirectUri = `${process.env.APP_URL?.replace(/\/$/, "") || url.origin}/api/kb/github/callback`;
  const res = NextResponse.redirect(authorizeUrl({ clientId: id, redirectUri, state, includePrivate: url.searchParams.get("private") === "1" }), 307);
  res.cookies.set(STATE_COOKIE, `${state}|${url.searchParams.get("private") === "1" ? "1" : "0"}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/kb/github", maxAge: 600 });
  return res;
}
