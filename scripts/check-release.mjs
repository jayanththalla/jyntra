// Fails if the working tree would leak secrets into a release archive.   node scripts/check-release.mjs
// Build the archive from the files this lists as allowed:  see "package" in docs/SECURITY.md.
import fs from "node:fs";
import path from "node:path";

const BAD_NAMES = [/^\.env(\..+)?$/, /\.pem$/, /id_rsa/, /^\.neon$/, /^\.pgdata$/];
const OK_NAMES = [/^\.env\.example$/];
const SECRET_SHAPES = [/AIza[0-9A-Za-z_-]{30,}/, /gsk_[0-9A-Za-z]{20,}/, /tvly-[0-9A-Za-z]{10,}/, /npg_[0-9A-Za-z]{8,}/, /ghp_[0-9A-Za-z]{30,}/, /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{6,}@(?!host\b|localhost|127\.0\.0\.1|db\.example\.com|example\.)[A-Za-z0-9.-]+/];
const SKIP = new Set(["node_modules", ".next", ".git", ".cache", ".pgdata"]);
const problems = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (BAD_NAMES.some((r) => r.test(e.name))) problems.push(`${p}/ (must not be shipped)`); else walk(p); continue; }
    if (BAD_NAMES.some((r) => r.test(e.name)) && !OK_NAMES.some((r) => r.test(e.name))) problems.push(`${p} (must not be shipped)`);
    if (fs.statSync(p).size < 400_000 && /\.(ts|tsx|js|mjs|json|md|yml|yaml|env|example|sql)$/.test(e.name) && !OK_NAMES.some((r) => r.test(e.name))) {
      const text = fs.readFileSync(p, "utf8");
      for (const re of SECRET_SHAPES) if (re.test(text)) problems.push(`${p}: contains a secret-shaped value (${re.source.slice(0, 18)}…)`);
    }
  }
})(".");
if (problems.length) { console.error("RELEASE BLOCKED:\n  " + [...new Set(problems)].join("\n  ")); process.exit(1); }
console.log("release check passed: no env files or secret-shaped values found");
