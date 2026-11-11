// Unit tests for credential vaulting (no database, no network).
import assert from "node:assert/strict";
import { seal, open, vaultConfigured, VaultNotConfigured, VaultDecryptError } from "@/lib/secrets/vault";
import { applyGmailPassword, resolveGmailPassword, publicProfile, normalizeAppPassword } from "@/lib/secrets/gmail";
import { sendPersonalGmail } from "@/lib/outreach/sender";

let passed = 0, failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n")[0]}`); }
}
const ENV = { CREDENTIAL_ENCRYPTION_KEY: "a".repeat(40) };
const OTHER = { CREDENTIAL_ENCRYPTION_KEY: "b".repeat(40) };
const PW = "abcdefghijklmnop";

async function main() {
  console.log("vault");
  await t("round trip; ciphertext hides the secret and differs each time", () => {
    const e = seal(PW, "gmail-smtp", 1, ENV);
    assert.ok(e.startsWith("v2.") && !e.includes(PW));
    assert.equal(open(e, "gmail-smtp", 1, ENV), PW);
    assert.notEqual(e, seal(PW, "gmail-smtp", 1, ENV));
  });
  await t("tampered ciphertext, tag or envelope fails authentication", () => {
    const [v, iv, tag, data] = seal(PW, "gmail-smtp", 1, ENV).split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [[v, iv, tag, flip(data)], [v, flip(iv), tag, data], [v, iv, flip(tag), data], ["v1", iv, tag, data], [v, iv, tag]])
      assert.throws(() => open(bad.join("."), "gmail-smtp", 1, ENV), VaultDecryptError);
    assert.throws(() => open("garbage", "gmail-smtp", 1, ENV), VaultDecryptError);
  });
  await t("a ciphertext cannot be moved to another user or opened with another key", () => {
    const e = seal(PW, "gmail-smtp", 1, ENV);
    assert.throws(() => open(e, "gmail-smtp", 2, ENV), VaultDecryptError);
    assert.throws(() => open(e, "gmail-smtp", 1, OTHER), VaultDecryptError);
  });
  await t("missing or short key: nothing is encrypted, nothing is decrypted, nothing falls back to plaintext", () => {
    for (const env of [{}, { CREDENTIAL_ENCRYPTION_KEY: "short" }]) {
      assert.equal(vaultConfigured(env), false);
      assert.throws(() => seal(PW, "gmail-smtp", 1, env), VaultNotConfigured);
    }
    assert.throws(() => open(seal(PW, "gmail-smtp", 1, ENV), "gmail-smtp", 1, {}), VaultNotConfigured);
    assert.equal(vaultConfigured({ KB_ENCRYPTION_KEY: "k".repeat(32) }), true); // documented fallback
  });
  await t("errors never contain the secret or the key", () => {
    try { open(seal(PW, "gmail-smtp", 1, ENV), "gmail-smtp", 2, ENV); } catch (e) { assert.ok(!String((e as Error).message + (e as Error).stack).match(new RegExp(PW + "|" + ENV.CREDENTIAL_ENCRYPTION_KEY))); }
  });

  console.log("gmail credential lifecycle");
  const base: any = { gmail_user: "me@gmail.com" };
  await t("save: valid password is stored only as ciphertext; spaces allowed", () => {
    const r = applyGmailPassword(base, 7, "abcd efgh ijkl mnop", "me@gmail.com", ENV);
    assert.ok(r.enc && !r.enc.includes("abcd"));
    assert.equal(open(r.enc!, "gmail-smtp", 7, ENV), PW);
  });
  await t("save: invalid password rejected; no key → refused (never plaintext); no account yet → refused", () => {
    assert.equal(applyGmailPassword(base, 7, "my normal password!", "me@gmail.com", ENV).error, "invalid_password");
    assert.equal(applyGmailPassword(base, 7, PW, "me@gmail.com", {}).error, "not_configured");
    assert.equal(applyGmailPassword(base, null, PW, "me@gmail.com", ENV).error, "needs_account");
    assert.equal(normalizeAppPassword("x".repeat(15)), null);
  });
  await t("update: blank keeps the saved one; clearing the Gmail address deletes it; new value replaces it", () => {
    const withEnc: any = { ...base, gmail_app_password_enc: seal(PW, "gmail-smtp", 7, ENV) };
    assert.equal(applyGmailPassword(withEnc, 7, "", "me@gmail.com", ENV).enc, withEnc.gmail_app_password_enc);
    assert.equal(applyGmailPassword(withEnc, 7, undefined, undefined, ENV).enc, withEnc.gmail_app_password_enc);
    assert.equal(applyGmailPassword(withEnc, 7, "ignored", "", ENV).enc, undefined);
    const next = applyGmailPassword(withEnc, 7, "zzzzzzzzzzzzzzzz", "me@gmail.com", ENV).enc!;
    assert.notEqual(next, withEnc.gmail_app_password_enc);
    assert.equal(open(next, "gmail-smtp", 7, ENV), "zzzzzzzzzzzzzzzz");
  });
  await t("use: decrypts for the owner; legacy plaintext and foreign ciphertext are never used", () => {
    const p: any = { gmail_app_password_enc: seal(PW, "gmail-smtp", 7, ENV) };
    assert.deepEqual(resolveGmailPassword(7, p, ENV), { ok: true, pass: PW });
    assert.deepEqual(resolveGmailPassword(8, p, ENV), { ok: false, reason: "reenter" });
    assert.deepEqual(resolveGmailPassword(7, p, {}), { ok: false, reason: "not_configured" });
    assert.deepEqual(resolveGmailPassword(7, { gmail_app_password: PW } as any, ENV), { ok: false, reason: "reenter" });
    assert.deepEqual(resolveGmailPassword(7, {} as any, ENV), { ok: false, reason: "not_set" });
  });
  await t("API view: no password, no ciphertext, only flags", () => {
    const view: any = publicProfile({ gmail_user: "me@gmail.com", gmail_app_password_enc: "v2.a.b.c", gmail_app_password: "legacyplaintext1" } as any);
    assert.ok(!JSON.stringify(view).match(/v2\.a\.b\.c|legacyplaintext1/));
    assert.equal(view.gmail_app_password_set, true);
    assert.equal(publicProfile({ gmail_app_password: "x" } as any).gmail_app_password_reenter, true);
  });
  await t("sender: no server-wide mailbox fallback; invalid credentials surface a safe error", async () => {
    process.env.GMAIL_USER = "operator@gmail.com"; process.env.GMAIL_APP_PASSWORD = "operatorpassword1";
    let called = false;
    const r = await sendPersonalGmail({ to: "a@b.co", subject: "s", text: "t", credentials: {} }, { createTransport: () => { called = true; return { sendMail: async () => ({}) }; } });
    assert.equal(r.ok, false); assert.equal(called, false);
    const bad = await sendPersonalGmail({ to: "a@b.co", subject: "s", text: "t", credentials: { user: "me@gmail.com", pass: PW } }, { createTransport: () => ({ sendMail: async () => { throw Object.assign(new Error("535 Invalid login " + PW), { code: "EAUTH" }); } }) });
    assert.equal(bad.ok, false); assert.ok(!String(bad.error).includes(PW));
    delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;
  });

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
  if (failed) process.exit(1);
}
main();
