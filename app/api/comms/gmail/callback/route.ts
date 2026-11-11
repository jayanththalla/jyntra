// Google redirects here with ?code&state. The account is stored ONLY after the code is exchanged, the scope checked and the address read.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/users";
import { accountEmail, exchangeCode, signState, STATE_COOKIE } from "@/lib/comms/gmail";
import { upsertAccount } from "@/lib/comms/store";
import { seal, vaultConfigured } from "@/lib/secrets/vault";

export const dynamic = "force-dynamic";
const back = (q: string) => new Response(null, { status: 307, headers: { Location: `/career-ai/email?${q}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Set-Cookie": `${STATE_COOKIE}=; Path=/api/comms/gmail; Max-Age=0; HttpOnly; SameSite=Lax` } });

export async function GET(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return back("error=no_profile");
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("error=gmail_denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const cookieState = (await cookies()).get(STATE_COOKIE)?.value ?? "";
  const [nonce, sig] = state.split(".");
  const expected = nonce ? signState(user.id, nonce) : "";
  const ok = !!code && !!cookieState && cookieState === state && !!sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !vaultConfigured()) return back("error=gmail_state");
  try {
    const redirectUri = `${process.env.APP_URL?.replace(/\/$/, "") || url.origin}/api/comms/gmail/callback`;
    const t = await exchangeCode({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, code: code!, redirectUri });
    const email = await accountEmail(t.accessToken);
    await upsertAccount(user.id, email, seal(t.refreshToken, "gmail-oauth", user.id));
    return back("connected=gmail");
  } catch (e) {
    return back(`error=${(e as Error).message === "scope_missing" ? "gmail_scope" : "gmail_failed"}`);
  }
}
