// Credential encryption (AES-256-GCM). The key comes from KB_ENCRYPTION_KEY (>= 32 chars). Without it,
// connectors that store a token refuse to connect: we never fall back to storing secrets in the clear.
import crypto from "node:crypto";

export class NotConfigured extends Error {}

function key(env = process.env): Buffer {
  const raw = env.KB_ENCRYPTION_KEY ?? "";
  if (raw.length < 32) throw new NotConfigured("KB_ENCRYPTION_KEY is not set (needs 32+ characters)");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export const encryptionConfigured = (env = process.env) => (env.KB_ENCRYPTION_KEY ?? "").length >= 32;

/** "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptSecret(plain: string, env = process.env): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(env), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, env = process.env): string {
  const [v, iv, tag, data] = envelope.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("bad envelope");
  const d = crypto.createDecipheriv("aes-256-gcm", key(env), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
