// What must never be indexed, and how retrieved text is made safe to put in a prompt.

/** Paths that can hold secrets or are generated/vendored noise. Checked on every repository path. */
const EXCLUDED_PATH = [
  /(^|\/)\.env(?!\.(example|sample|template)$)(\..*)?$/i,
  /(^|\/)(id_rsa|id_ed25519|id_dsa)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|gpg|asc)$/i,
  /(^|\/)(credentials|secrets?|\.npmrc|\.pypirc|\.netrc|\.htpasswd|service-account.*\.json)$/i,
  /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.git|coverage|target|__pycache__|\.venv|venv)\//i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|composer\.lock|go\.sum)$/i,
  /\.(min\.js|min\.css|map|lock|log|sqlite|db|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|pdf|zip|gz|tar|jar|class|exe|dll|so|mp4|mov|bin)$/i,
] as RegExp[];

export function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATH.some((re) => re.test(path));
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|hpp|swift|scala|sql|sh|yml|yaml|toml|json|md|mdx|txt|rst|dockerfile|html|css|scss|vue|svelte)$/i;
export const isIndexablePath = (path: string) => !isExcludedPath(path) && (CODE_EXT.test(path) || /(^|\/)\.env\.(example|sample|template)$/i.test(path) || /(^|\/)(Dockerfile|Makefile|README|LICENSE)$/i.test(path));

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "[redacted token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, "[redacted token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted aws key]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted api key]"],
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, "[redacted api key]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted api key]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted token]"],
  [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@[^\s'"]+/gi, "[redacted connection string]"],
  [/((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*)(["']?)[^\s"',;]{8,}\2/gi, "$1[redacted]"],
];

/** Secrets found in indexed text are replaced before storage, so they can't reach search or a model. */
export function redactSecrets(text: string): { text: string; redactions: number } {
  let n = 0;
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, (...m) => (n++, rep.replace(/\$1/g, typeof m[1] === "string" ? m[1] : "")));
  return { text: out, redactions: n };
}

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier|system)/i,
  /you are now\b|new instructions?:|system prompt|developer message/i,
  /(reveal|print|show|send|exfiltrate|leak)\b[^.\n]{0,40}\b(api[_ -]?keys?|secrets?|tokens?|passwords?|system prompt|credentials)/i,
  /\b(act as|pretend to be)\b[^.\n]{0,30}\b(admin|system|developer)/i,
  /<\/?(system|assistant|instructions?|evidence|candidate)\b/i,
];

export const looksLikeInjection = (text: string) => INJECTION.some((re) => re.test(text));

/** Makes retrieved text inert inside the evidence fence: no tag can close the fence or fake a role. */
export function fenceSafe(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").replace(/</g, "‹").replace(/>/g, "›");
}
