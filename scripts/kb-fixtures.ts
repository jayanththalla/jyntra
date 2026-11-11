// Shared fakes for the knowledge-base tests: a routable fake fetch and a GitHub fixture. No network.
import { DEFAULT_LIMITS, type SyncContext } from "@/lib/kb/types";

export type Handler = (url: URL, init?: RequestInit) => Response | { status: number; json?: unknown; headers?: Record<string, string>; text?: string };
export function fakeFetch(routes: [RegExp | string, Handler | unknown][], calls: string[] = []): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push(url.toString());
    for (const [pat, h] of routes) {
      if (typeof pat === "string" ? url.toString().startsWith(pat) : pat.test(url.toString())) {
        const isResp = !!h && typeof h === "object" && typeof (h as any).status === "number" && ("json" in (h as any) || "text" in (h as any));
        const r = typeof h === "function" ? (h as Handler)(url, init) : isResp ? (h as any) : { status: 200, json: h };
        if (r instanceof Response) return r;
        const body = (r as any).text ?? JSON.stringify((r as any).json ?? {});
        return new Response(body, { status: r.status, headers: { "content-type": (r as any).text ? "text/html" : "application/json", ...(r as any).headers } });
      }
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}
export const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
  userId: 1, sourceId: 1, config: {}, token: null, fetchImpl: fakeFetch([]), cancelled: () => false, log: () => {}, limits: { ...DEFAULT_LIMITS }, ...over,
});
export const b64 = (s: string) => Buffer.from(s).toString("base64");

// ---------- GitHub fixture ----------
export const GH = "https://api.github.com";
export function githubRoutes(opts: { privateRepo?: boolean; rateLimitOn?: string } = {}): [RegExp | string, Handler | unknown][] {
  const repo = (name: string, extra: any = {}) => ({ full_name: `me/${name}`, name, description: `${name} app`, html_url: `https://github.com/me/${name}`, fork: false, archived: false, private: false, default_branch: "main", pushed_at: "2026-10-01T00:00:00Z", stargazers_count: 3, language: "TypeScript", topics: ["web"], owner: { login: "me" }, ...extra });
  const repos = [repo("alpha"), repo("beta"), repo("forked", { fork: true }), repo("secret", { private: true })];
  const tree = [
    { path: "README.md", type: "blob", size: 100 }, { path: "package.json", type: "blob", size: 200 }, { path: ".env", type: "blob", size: 50 }, { path: ".env.local", type: "blob", size: 50 },
    { path: "package-lock.json", type: "blob", size: 900 }, { path: "node_modules/x/index.js", type: "blob", size: 30 }, { path: "deploy/server.pem", type: "blob", size: 30 }, { path: "id_rsa", type: "blob", size: 30 },
    { path: "src/index.ts", type: "blob", size: 120 }, { path: "docs/architecture.md", type: "blob", size: 80 }, { path: "src/big.ts", type: "blob", size: 9_999_999 }, { path: "logo.png", type: "blob", size: 10 }, { path: "src", type: "tree" },
  ];
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ dependencies: { next: "15", react: "19", pg: "8", openai: "4" }, devDependencies: { typescript: "5" } }),
    "src/index.ts": `const token = "ghp_${"a".repeat(36)}";\nexport const x = 1;\nconst db = "postgres://user:hunter2pass@db.example.com/app";`,
    "docs/architecture.md": "# Architecture\nRequests go through the API layer to PostgreSQL.",
  };
  const file = (p: string) => ({ encoding: "base64", content: b64(files[p] ?? ""), size: (files[p] ?? "").length });
  return [
    [`${GH}/user/repos`, repos.filter((r) => opts.privateRepo || true)],
    [`${GH}/user?`, { login: "me" }], [new RegExp(`^${GH}/user$`), { login: "me" }],
    [new RegExp(`${GH}/users/me/repos`), repos.filter((r) => !r.private)],
    [/\/repos\/me\/(\w+)\/languages/, { TypeScript: 9000, CSS: 100 }],
    [/\/repos\/me\/(\w+)\/git\/trees/, (u: URL) => (opts.rateLimitOn && u.pathname.includes(opts.rateLimitOn) ? { status: 403, headers: { "retry-after": "3600", "x-ratelimit-remaining": "0" }, json: { message: "rate" } } : { status: 200, json: { tree } })],
    [/\/repos\/me\/(\w+)\/readme/, { content: b64("# Alpha\nA Next.js app. password = supersecretvalue1"), path: "README.md", html_url: "https://github.com/me/alpha/blob/main/README.md" }],
    [/\/repos\/me\/\w+\/contents\/(.+)\?/, (u: URL) => ({ status: 200, json: file(decodeURIComponent(u.pathname.split("/contents/")[1])) })],
    [/\/repos\/me\/\w+\/commits/, [{ sha: "abcdef1234", commit: { message: "Add auth\n\nbody", author: { date: "2026-10-01T00:00:00Z" } } }]],
    [/\/search\/issues/, (u: URL) => ({ status: 200, json: { items: [{ number: 7, title: u.search.includes("is%3Apr") ? "Add caching" : "Bug report", body: "details", html_url: "https://github.com/me/alpha/pull/7", updated_at: "2026-10-02T00:00:00Z" }] } })],
  ];
}

