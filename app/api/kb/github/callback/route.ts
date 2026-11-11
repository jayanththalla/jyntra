// GitHub redirects here with ?code&state. The source is created ONLY after the token is exchanged and verified.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/users";
import { exchangeCode, verifyToken } from "@/lib/kb/connectors/github";
import { encryptSecret, encryptionConfigured } from "@/lib/kb/crypto";
import { createSource } from "@/lib/kb/store";
import { syncInBackground } from "@/lib/kb/sync";
import { STATE_COOKIE, signState } from "@/lib/kb/oauth-state";

export const dynamic = "force-dynamic";

const back = (q: string) => new Response(null, { status: 307, headers: { Location: `/career-ai?${q}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return back("error=no_profile");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const jar = await cookies();
  const [cookieState, priv] = (jar.get(STATE_COOKIE)?.value ?? "").split("|");
  const [nonce, sig] = state.split(".");
  const expected = nonce ? signState(user.id, nonce) : "";
  const ok = !!code && !!cookieState && cookieState === state && !!sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (url.searchParams.get("error")) return back("error=github_denied");
  if (!ok || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET || !encryptionConfigured()) return back("error=github_state");
  try {
    const redirectUri = `${process.env.APP_URL?.replace(/\/$/, "") || url.origin}/api/kb/github/callback`;
    const { token } = await exchangeCode({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, code: code!, redirectUri });
    const v = await verifyToken(token);
    const src = await createSource(user.id, {
      provider: "github", label: `GitHub: ${v.login}`, credentialsEnc: encryptSecret(token),
      config: { login: v.login, repos: [], includePrivate: priv === "1" && v.scopes.includes("repo") },
    });
    syncInBackground(user.id, src.id);
    const res = back("connected=github");
    res.headers.append("Set-Cookie", `${STATE_COOKIE}=; Path=/api/kb/github; Max-Age=0; HttpOnly; SameSite=Lax`);
    return res;
  } catch {
    return back("error=github_failed");
  }
}
