import crypto from "node:crypto";
export const STATE_COOKIE = "kb_gh_state";
export const signState = (userId: number, nonce: string) =>
  crypto.createHmac("sha256", (process.env.KB_ENCRYPTION_KEY ?? "") + "|oauth-state").update(`${userId}.${nonce}`).digest("base64url");
