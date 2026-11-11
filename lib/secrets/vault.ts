// Authenticated encryption for credentials that live in the database (Gmail app passwords).
//  * AES-256-GCM, random 96-bit IV per message.
//  * The key never touches the database or source control: CREDENTIAL_ENCRYPTION_KEY (dedicated),
//    falling back to KB_ENCRYPTION_KEY so existing deployments need no extra setup.
//  * A purpose-specific subkey is derived with HKDF-SHA256, so a key reused across features
//    does not produce interchangeable ciphertexts.
//  * The owner (user id) is bound as additional authenticated data: a ciphertext copied from one
//    user's row to another's fails authentication instead of decrypting.
//  * Envelope: "v2.<iv>.<tag>.<ciphertext>" (base64url). Errors never include secret material.
import crypto from "node:crypto";

export class VaultNotConfigured extends Error {
  constructor() {
    super("Credential encryption is not configured (set CREDENTIAL_ENCRYPTION_KEY, 32+ characters).");
  }
}
export class VaultDecryptError extends Error {
  constructor() {
    super("Stored credential could not be decrypted.");
  }
}

export type Purpose = "gmail-smtp" | "gmail-oauth";
type Env = Record<string, string | undefined>;

function rawKey(env: Env): string {
  const k = env.CREDENTIAL_ENCRYPTION_KEY || env.KB_ENCRYPTION_KEY || "";
  return k.length >= 32 ? k : "";
}

export const vaultConfigured = (env: Env = process.env) => rawKey(env) !== "";

function subkey(purpose: Purpose, env: Env): Buffer {
  const k = rawKey(env);
  if (!k) throw new VaultNotConfigured();
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(k, "utf8"), Buffer.from("jyntra-vault-v2"), Buffer.from(purpose), 32));
}

const aadFor = (purpose: Purpose, ownerId: number) => Buffer.from(`${purpose}:${ownerId}`, "utf8");

export function seal(plain: string, purpose: Purpose, ownerId: number, env: Env = process.env): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", subkey(purpose, env), iv);
  c.setAAD(aadFor(purpose, ownerId));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v2", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function open(envelope: string, purpose: Purpose, ownerId: number, env: Env = process.env): string {
  const [v, iv, tag, data] = String(envelope).split(".");
  if (v !== "v2" || !iv || !tag || !data) throw new VaultDecryptError();
  const key = subkey(purpose, env); // VaultNotConfigured propagates: that is a deployment problem, not tampering
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAAD(aadFor(purpose, ownerId));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new VaultDecryptError();
  }
}
