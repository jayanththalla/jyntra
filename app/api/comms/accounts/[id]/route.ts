// Disconnect: revoke the token at Google (best effort, reported honestly) and delete our copy either way.
import { guard, json, err, toId } from "@/lib/kb/api";
import { removeAccount } from "@/lib/comms/store";
import { revokeToken } from "@/lib/comms/gmail";
import { open } from "@/lib/secrets/vault";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const removed = id ? await removeAccount(g.user.id, id) : null;
  if (!removed) return err("not_found", 404);
  let revoked = false;
  if (removed.refresh_token_enc) {
    try { revoked = await revokeToken(open(removed.refresh_token_enc, "gmail-oauth", g.user.id)); } catch { revoked = false; }
  }
  return json({ ok: true, revoked_at_google: revoked, message: revoked ? "Disconnected, and Google confirmed the access was revoked." : "Disconnected here. Google didn't confirm the revocation; you can also remove access at myaccount.google.com/permissions." });
}
