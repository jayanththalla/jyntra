// Connection status for sending mail. Never returns tokens, passwords or ciphertext.
import { guard, json } from "@/lib/kb/api";
import { getAccount, publicAccount } from "@/lib/comms/store";
import { gmailOAuthConfigured } from "@/lib/comms/gmail";
import { vaultConfigured } from "@/lib/secrets/vault";
import { gmailPasswordState } from "@/lib/secrets/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const a = await getAccount(g.user.id);
  const p = g.user.profile;
  return json({
    gmail: { configured: gmailOAuthConfigured() && vaultConfigured(), account: a ? publicAccount(a) : null },
    smtp: { address: p.gmail_user ?? null, password_set: gmailPasswordState(p).gmail_app_password_set, available: vaultConfigured() },
  });
}
