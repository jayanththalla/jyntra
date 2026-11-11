export {};
// One-off, idempotent migration for Gmail app passwords stored in plaintext in users.profile.
//   npx tsx scripts/migrate-gmail-credentials.ts            encrypt plaintext in place (needs CREDENTIAL_ENCRYPTION_KEY)
//   npx tsx scripts/migrate-gmail-credentials.ts --purge    delete plaintext instead; affected users re-enter it in Settings
//   add --dry-run to report counts only. Secret values are never printed.
try {
  process.loadEnvFile(".env");
} catch {}

async function main() {
  const { query, pool } = await import("@/lib/database");
  const { seal, vaultConfigured } = await import("@/lib/secrets/vault");
  const purge = process.argv.includes("--purge");
  const dry = process.argv.includes("--dry-run");
  if (!purge && !vaultConfigured()) {
    console.error("CREDENTIAL_ENCRYPTION_KEY (or KB_ENCRYPTION_KEY) is not set. Set it, or re-run with --purge to delete the plaintext.");
    process.exit(2);
  }
  const rows = await query<{ id: number; profile: any }>("SELECT id, profile FROM users WHERE profile ? 'gmail_app_password'");
  let encrypted = 0, purged = 0, cleared = 0;
  for (const r of rows) {
    const { gmail_app_password: plain, ...rest } = r.profile ?? {};
    if (typeof plain !== "string" || !plain.trim()) { cleared++; if (!dry) await query("UPDATE users SET profile = $2 WHERE id = $1", [r.id, JSON.stringify(rest)]); continue; }
    if (purge) { purged++; if (!dry) await query("UPDATE users SET profile = $2 WHERE id = $1", [r.id, JSON.stringify(rest)]); continue; }
    encrypted++;
    if (!dry) await query("UPDATE users SET profile = $2 WHERE id = $1", [r.id, JSON.stringify({ ...rest, gmail_app_password_enc: seal(plain.replace(/\s+/g, ""), "gmail-smtp", r.id) })]);
  }
  // The pre-multi-user snapshot table may also hold the old profile.
  const legacy = await query("SELECT 1 FROM candidate_profile WHERE data ? 'gmail_app_password' LIMIT 1").catch(() => []);
  if (legacy.length && !dry) await query("UPDATE candidate_profile SET data = data - 'gmail_app_password' WHERE data ? 'gmail_app_password'");
  console.log(`${dry ? "[dry run] " : ""}users with a stored password field: ${rows.length}; encrypted: ${encrypted}; purged (re-entry needed): ${purged}; empty fields removed: ${cleared}; legacy snapshot rows cleaned: ${legacy.length ? "yes" : "none"}`);
  await pool().end();
}
main().catch((e) => { console.error("migration failed:", (e as any)?.code ?? (e as Error).name); process.exit(1); });
