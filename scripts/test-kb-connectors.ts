// Connector + extraction tests. No network: every provider is a fake fetch. Run: npm run test:kb-connectors
import assert from "node:assert/strict";
import { extractText } from "@/lib/kb/extract";
import { githubConnector, parseManifest, authorizeUrl, exchangeCode, verifyToken, pickFiles } from "@/lib/kb/connectors/github";
import { codeforcesConnector, setCodeforcesSleep } from "@/lib/kb/connectors/codeforces";
import { leetcodeConnector, parseLeetCodeExport } from "@/lib/kb/connectors/leetcode";
import { manualConnector, portfolioConnector, setHostResolver, splitProfileSections } from "@/lib/kb/connectors/manual";
import { getConnector, SUPPORTED_PROVIDERS } from "@/lib/kb/connectors";
import { DEFAULT_LIMITS, SourceError, type SyncContext } from "@/lib/kb/types";

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

setCodeforcesSleep(async () => {});
setHostResolver(async (h) => (/^(intranet|evil)\./.test(h) ? ["10.0.0.5"] : ["93.184.216.34"]));

// ---------- helpers ----------
type Handler = (url: URL, init?: RequestInit) => Response | { status: number; json?: unknown; headers?: Record<string, string>; text?: string };
function fakeFetch(routes: [RegExp | string, Handler | unknown][], calls: string[] = []): typeof fetch {
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
const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
  userId: 1, sourceId: 1, config: {}, token: null, fetchImpl: fakeFetch([]), cancelled: () => false, log: () => {}, limits: { ...DEFAULT_LIMITS }, ...over,
});
const b64 = (s: string) => Buffer.from(s).toString("base64");

// ---------- GitHub fixture ----------
const GH = "https://api.github.com";
function githubRoutes(opts: { privateRepo?: boolean; rateLimitOn?: string } = {}): [RegExp | string, Handler | unknown][] {
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

(async () => {
  console.log("github");
  await t("happy path: README, manifest with technologies, summary, source, PR, commits", async () => {
    const r = await githubConnector.sync(ctx({ token: "tok", config: {}, fetchImpl: fakeFetch(githubRoutes()) }));
    const types = new Set(r.docs.map((d) => d.docType));
    for (const k of ["readme", "manifest", "doc", "code", "pull_request", "issue", "commits"]) assert.ok(types.has(k as any), `missing ${k}`);
    const man = r.docs.find((d) => d.docType === "manifest" && d.project === "alpha")!;
    assert.deepEqual((man.metadata!.technologies as string[]).filter((x) => ["Next.js", "React", "PostgreSQL", "TypeScript"].includes(x)).sort(), ["Next.js", "PostgreSQL", "React", "TypeScript"]);
    assert.equal(r.docs.find((d) => d.externalId === "me/alpha:src/index.ts")!.project, "alpha");
    assert.ok(r.docs.every((d) => !d.url || /^https:/.test(d.url)));
    assert.equal(r.complete, true);
  });
  await t("excluded files never appear; secrets are redacted in included files", async () => {
    const r = await githubConnector.sync(ctx({ token: "tok", fetchImpl: fakeFetch(githubRoutes()) }));
    const ids = r.docs.map((d) => d.externalId).join("\n");
    for (const bad of [".env", "package-lock.json", "node_modules", "server.pem", "id_rsa", "logo.png", "big.ts"]) assert.ok(!ids.includes(bad), `${bad} was indexed`);
    const all = r.docs.map((d) => d.content).join("\n");
    assert.ok(!all.includes("ghp_" + "a".repeat(36)) && !all.includes("hunter2pass") && !all.includes("supersecretvalue1"));
    assert.ok(all.includes("[redacted"));
  });
  await t("private repos excluded unless includePrivate; forks skipped", async () => {
    const names = (r: any) => new Set(r.docs.map((d: any) => d.project));
    const a = await githubConnector.sync(ctx({ token: "tok", fetchImpl: fakeFetch(githubRoutes()) }));
    assert.ok(!names(a).has("secret") && !names(a).has("forked") && names(a).has("alpha"));
    const b = await githubConnector.sync(ctx({ token: "tok", config: { includePrivate: true }, fetchImpl: fakeFetch(githubRoutes()) }));
    assert.ok(names(b).has("secret") && !names(b).has("forked"));
  });
  await t("public username works without a token and sends no Authorization header", async () => {
    const seen: (string | null)[] = [];
    const f = fakeFetch(githubRoutes(), []);
    const wrapped = ((u: any, i: any) => { seen.push(new Headers(i?.headers).get("authorization")); return f(u, i); }) as typeof fetch;
    const r = await githubConnector.sync(ctx({ config: { login: "me" }, fetchImpl: wrapped }));
    assert.ok(r.docs.length > 0);
    assert.ok(seen.every((x) => x === null));
    assert.ok(!r.docs.some((d) => d.docType === "pull_request"), "no PR search without identity");
  });
  await t("a short project list is explained: skipped forks/private and the unauthenticated limit appear as warnings", async () => {
    const a = await githubConnector.sync(ctx({ token: "tok", fetchImpl: fakeFetch(githubRoutes()) }));
    const w = a.warnings.join(" ");
    assert.match(w, /Indexing \d+ of \d+ repositories/);
    assert.match(w, /forked/);
    assert.match(w, /private/);
    assert.ok(!/60-requests/.test(w), "signed-in sync does not claim the anonymous limit");
    const b = await githubConnector.sync(ctx({ config: { login: "me" }, fetchImpl: fakeFetch(githubRoutes(), []) }));
    assert.match(b.warnings.join(" "), /60-requests-an-hour/);
  });
  await t("allow-list limits repositories", async () => {
    const r = await githubConnector.sync(ctx({ token: "tok", config: { repos: ["me/beta"] }, fetchImpl: fakeFetch(githubRoutes()) }));
    assert.deepEqual([...new Set(r.docs.map((d) => d.project))], ["beta"]);
  });
  await t("401 → revoked/unauthorized SourceError", async () => {
    const f = fakeFetch([[/api\.github\.com/, { status: 401, json: { message: "Bad credentials" } }]]);
    await assert.rejects(githubConnector.sync(ctx({ token: "tok", fetchImpl: f })), (e: any) => e instanceof SourceError && (e.code === "revoked" || e.code === "unauthorized"));
  });
  await t("rate limit mid-run → partial docs, complete:false, warning", async () => {
    const r = await githubConnector.sync(ctx({ token: "tok", fetchImpl: fakeFetch(githubRoutes({ rateLimitOn: "/beta/" })) }));
    assert.equal(r.complete, false);
    assert.ok(r.docs.some((d) => d.project === "alpha"));
    assert.ok(!r.docs.some((d) => d.project === "beta"), "half-read repo dropped");
    assert.ok(r.warnings.some((w) => /rate limit/i.test(w)));
  });
  await t("cancel stops between repositories", async () => {
    let n = 0;
    const r = await githubConnector.sync(ctx({ token: "tok", fetchImpl: fakeFetch(githubRoutes()), cancelled: () => n++ >= 1 }));
    assert.equal(r.complete, false);
    assert.ok(new Set(r.docs.map((d) => d.project)).size <= 1);
  });
  await t("invalid username rejected before any request", async () => {
    const calls: string[] = [];
    await assert.rejects(githubConnector.sync(ctx({ config: { login: "bad name/../x" }, fetchImpl: fakeFetch([], calls) })), (e: any) => e.code === "invalid");
    assert.equal(calls.length, 0);
  });
  await t("OAuth helpers: scopes, exchange, verify", async () => {
    assert.match(authorizeUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s" }), /scope=read%3Auser(&|$)/);
    assert.match(authorizeUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s", includePrivate: true }), /scope=read%3Auser\+repo/);
    const ex = await exchangeCode({ clientId: "c", clientSecret: "s", code: "k", redirectUri: "r", fetchImpl: fakeFetch([["https://github.com/login/oauth/access_token", { access_token: "gho_x", scope: "read:user" }]]) });
    assert.equal(ex.token, "gho_x");
    await assert.rejects(exchangeCode({ clientId: "c", clientSecret: "s", code: "k", redirectUri: "r", fetchImpl: fakeFetch([["https://github.com/login/oauth/access_token", { error: "bad_verification_code" }]]) }), (e: any) => e.code === "unauthorized");
    const v = await verifyToken("t", fakeFetch([[`${GH}/user`, () => ({ status: 200, json: { login: "me" }, headers: { "x-oauth-scopes": "read:user, repo" } })]]));
    assert.deepEqual(v, { login: "me", scopes: ["read:user", "repo"] });
    await assert.rejects(verifyToken("t", fakeFetch([[`${GH}/user`, { status: 401, json: {} }]])), (e: any) => e.code === "unauthorized");
  });
  await t("manifest parsing and file prioritisation", () => {
    assert.ok(parseManifest("requirements.txt", "django==4\npsycopg2-binary\nnumpy>=1").includes("Django"));
    assert.ok(parseManifest("go.mod", "require github.com/gin-gonic/gin v1.9.0").includes("Gin"));
    assert.deepEqual(parseManifest("package.json", "{not json"), []);
    const picked = pickFiles([{ path: "z/util.ts", type: "blob", size: 5 }, { path: "docs/design.md", type: "blob", size: 5 }, { path: "Dockerfile", type: "blob", size: 5 }], 2, 1000).map((f) => f.path);
    assert.deepEqual(picked, ["docs/design.md", "Dockerfile"]);
  });

  console.log("codeforces");
  const cfRoutes = (opts: { missing?: boolean } = {}): [RegExp, Handler | unknown][] => [
    [/user\.info/, () => (opts.missing ? { status: 400, json: { status: "FAILED", comment: "handles: User with handle nobody not found" } } : { status: 200, json: { status: "OK", result: [{ handle: "tourist", rating: 1650, maxRating: 1700, rank: "expert", maxRank: "expert" }] } })],
    [/user\.rating/, { status: "OK", result: [{ contestName: "Round 1", rank: 100, oldRating: 1500, newRating: 1580, ratingUpdateTimeSeconds: 1760000000 }] }],
    [/user\.status/, { status: "OK", result: [
      { id: 1, creationTimeSeconds: 1760000100, verdict: "OK", programmingLanguage: "C++17", problem: { contestId: 1, index: "A", name: "Two Sum", rating: 800, tags: ["math", "greedy"] } },
      { id: 2, creationTimeSeconds: 1760000200, verdict: "WRONG_ANSWER", programmingLanguage: "C++17", problem: { contestId: 2, index: "B", name: "Hard One", rating: 2100, tags: ["dp"] } },
      { id: 3, creationTimeSeconds: 1760000300, verdict: "OK", programmingLanguage: "Python 3", problem: { contestId: 1, index: "A", name: "Two Sum", rating: 800, tags: ["math", "greedy"] } },
    ] }],
  ];
  await t("stats: distinct solved only, observed wording, tags and buckets", async () => {
    const r = await codeforcesConnector.sync(ctx({ config: { handle: "tourist" }, fetchImpl: fakeFetch(cfRoutes()) }));
    const sub = r.docs.find((d) => d.externalId.endsWith(":submissions"))!;
    assert.match(sub.content, /solved 1 distinct problems/);
    assert.match(sub.content, /math 1/);
    assert.ok(!/dp \d/.test(sub.content.split("tag")[1] ?? ""), "failed attempt not counted as solved");
    assert.match(sub.content, /not a measure of proficiency/);
    assert.match(r.docs[0].content, /Observed: current rating 1650/);
    assert.ok(r.docs.every((d) => d.docType === "coding_stats"));
    assert.equal(r.complete, true);
  });
  await t("unknown handle → not_found; bad handle → invalid with no request", async () => {
    await assert.rejects(codeforcesConnector.sync(ctx({ config: { handle: "nobody" }, fetchImpl: fakeFetch(cfRoutes({ missing: true })) })), (e: any) => e.code === "not_found");
    const calls: string[] = [];
    await assert.rejects(codeforcesConnector.sync(ctx({ config: { handle: "a b" }, fetchImpl: fakeFetch([], calls) })), (e: any) => e.code === "invalid");
    assert.equal(calls.length, 0);
  });
  await t("submissions failing → profile still indexed, complete:false", async () => {
    const routes = cfRoutes();
    routes[2] = [/user\.status/, { status: 500, json: {} }];
    const r = await codeforcesConnector.sync(ctx({ config: { handle: "tourist" }, fetchImpl: fakeFetch(routes) }));
    assert.equal(r.complete, false);
    assert.ok(r.docs.length >= 1 && r.warnings.length >= 1);
  });

  console.log("leetcode");
  await t("JSON export parses", () => {
    const e = parseLeetCodeExport(JSON.stringify({ problems: [{ title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"], language: "Python" }, { title: "LRU Cache", difficulty: "Medium", tags: "Design;Hash Table" }], stats: { Easy: 80, Medium: 120, Hard: 20 } }));
    assert.equal(e.problems.length, 2);
    assert.deepEqual(e.problems[1].topics, ["Design", "Hash Table"]);
    assert.equal(e.stats.Medium, 120);
  });
  await t("text and CSV exports parse, including stats lines", () => {
    const e = parseLeetCodeExport("Easy 80 Medium 120 Hard 20\nTwo Sum | Easy | Array; Hash Table | Python\nMerge Intervals - Medium");
    assert.equal(e.problems.length, 2);
    assert.equal(e.stats.Hard, 20);
    assert.equal(e.problems[1].difficulty, "Medium");
    const c = parseLeetCodeExport("title,difficulty,topics,language\nTwo Sum,Easy,Array,Go");
    assert.equal(c.problems[0].language, "Go");
  });
  await t("connector never touches the network; wording says user-provided", async () => {
    const calls: string[] = [];
    const r = await leetcodeConnector.sync(ctx({ config: { importText: "Two Sum | Easy | Array | Python", profileUrl: "https://leetcode.com/u/someone" }, fetchImpl: fakeFetch([], calls) }));
    assert.equal(calls.length, 0);
    assert.ok(r.docs.some((d) => /user-provided export/.test(d.content)));
    assert.ok(r.docs.some((d) => /no data imported automatically/.test(d.content)));
  });
  await t("bad profile URL and oversize import rejected", async () => {
    await assert.rejects(leetcodeConnector.sync(ctx({ config: { profileUrl: "https://evil.com/u/x" } })), (e: any) => e.code === "invalid");
    await assert.rejects(leetcodeConnector.sync(ctx({ config: { importText: "x".repeat(200_001) } })), (e: any) => e.code === "invalid");
    await assert.rejects(leetcodeConnector.sync(ctx({ config: {} })), (e: any) => e.code === "invalid");
  });

  console.log("linkedin / portfolio");
  await t("pasted LinkedIn text is split into sections without any fetch", async () => {
    const calls: string[] = [];
    const text = "Jane Doe\nBackend engineer building APIs\n\nExperience\nAcme Corp - Intern\n\nEducation\nState University BTech\n\nSkills\nPython, SQL\n\nCertifications\nAWS CCP";
    assert.deepEqual(splitProfileSections(text).map((s) => s.section), ["headline", "experience", "education", "skills", "certifications"]);
    const r = await manualConnector.sync(ctx({ config: { text, profileUrl: "https://www.linkedin.com/in/jane-doe" }, fetchImpl: fakeFetch([], calls) }));
    assert.equal(calls.length, 0);
    assert.equal(r.docs.length, 5);
    assert.ok(r.docs.every((d) => d.docType === "profile" && d.url === "https://www.linkedin.com/in/jane-doe"));
    await assert.rejects(manualConnector.sync(ctx({ config: { text, profileUrl: "https://evil.com/in/x" } })), (e: any) => e.code === "invalid");
  });
  await t("portfolio fetches a public page and strips scripts", async () => {
    const html = "<html><title>My Site</title><script>alert(1)</script><body><h1>Projects</h1><p>I built a compiler in Rust and a chat app.</p></body></html>";
    const r = await portfolioConnector.sync(ctx({ config: { url: "https://jane.dev/" }, fetchImpl: fakeFetch([["https://jane.dev/", { status: 200, text: html }]]) }));
    assert.match(r.docs[0].content, /compiler in Rust/);
    assert.ok(!/alert\(1\)/.test(r.docs[0].content));
  });
  await t("portfolio SSRF: localhost, 10.x, metadata IP, file:, userinfo, private DNS — nothing fetched", async () => {
    for (const url of ["http://localhost/", "http://127.0.0.1:8080/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "file:///etc/passwd", "ftp://x.com/", "https://user:pw@jane.dev/", "http://intranet.corp/"]) {
      const calls: string[] = [];
      await assert.rejects(portfolioConnector.sync(ctx({ config: { url }, fetchImpl: fakeFetch([], calls) })), (e: any) => e.code === "invalid", url);
      assert.equal(calls.length, 0, `${url} was fetched`);
    }
  });
  await t("portfolio SSRF: redirect to a private address is refused", async () => {
    const calls: string[] = [];
    const f = fakeFetch([["https://jane.dev/", () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })]], calls);
    await assert.rejects(portfolioConnector.sync(ctx({ config: { url: "https://jane.dev/" }, fetchImpl: f })), (e: any) => e.code === "invalid");
    assert.deepEqual(calls, ["https://jane.dev/"]);
  });
  await t("portfolio rejects non-HTML and oversize pages", async () => {
    const json = fakeFetch([["https://jane.dev/", () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })]]);
    await assert.rejects(portfolioConnector.sync(ctx({ config: { url: "https://jane.dev/" }, fetchImpl: json })), (e: any) => e.code === "invalid");
    const big = fakeFetch([["https://jane.dev/", () => new Response("<p>x</p>", { status: 200, headers: { "content-type": "text/html", "content-length": "900000" } })]]);
    await assert.rejects(portfolioConnector.sync(ctx({ config: { url: "https://jane.dev/" }, fetchImpl: big })), (e: any) => e.code === "invalid");
  });

  console.log("registry");
  await t("every supported provider has a connector", () => {
    for (const p of SUPPORTED_PROVIDERS) assert.ok(getConnector(p.provider), p.provider);
    assert.ok(SUPPORTED_PROVIDERS.find((p) => p.provider === "leetcode")!.auth === "manual");
  });

  console.log("extract");
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(entries: Record<string, string>): Buffer {
    const parts: Buffer[] = [], central: Buffer[] = [];
    let off = 0;
    for (const [name, data] of Object.entries(entries)) {
      const n = Buffer.from(name), d = Buffer.from(data), crc = crc32(d);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, n, d); central.push(ch, n); off += 30 + n.length + d.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, end]);
  }
  const docx = (text: string) => zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  });
  function pdf(text: string): Buffer {
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    let out = "%PDF-1.4\n"; const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }

  await t("txt: control chars stripped, secrets redacted, resume detected by name", async () => {
    const r = await extractText({ name: "Jane_Resume.txt", bytes: Buffer.from("Jane\u0007 Doe\nkey: ghp_" + "b".repeat(36) + "\nSkills: Go") }) as any;
    assert.ok(!r.error);
    assert.equal(r.docType, "resume");
    assert.ok(!r.text.includes("ghp_") && !r.text.includes("\u0007"));
    assert.ok(r.warnings.some((w: string) => /redacted/.test(w)));
  });
  await t("resume detected by headings; plain notes stay doc", async () => {
    assert.equal(((await extractText({ name: "x.md", bytes: Buffer.from("# Education\nBTech\n# Experience\nIntern") })) as any).docType, "resume");
    assert.equal(((await extractText({ name: "arch.md", bytes: Buffer.from("# Design\nwe use queues") })) as any).docType, "doc");
  });
  await t("docx text extracted", async () => {
    const r = (await extractText({ name: "report.docx", bytes: docx("Built a payment service with Kafka") })) as any;
    assert.match(r.text, /payment service with Kafka/);
  });
  await t("pdf text extracted", async () => {
    const r = (await extractText({ name: "notes.pdf", bytes: pdf("Interview prep sheet") })) as any;
    assert.ok(!r.error, r.message);
    assert.match(r.text, /Interview prep sheet/);
    assert.match(r.text, /\[page 1\]/);
  });
  await t("unsupported, empty, oversize, fake pdf/docx, binary-as-text are rejected", async () => {
    assert.equal(((await extractText({ name: "a.exe", bytes: Buffer.from("MZ") })) as any).error, "unsupported");
    assert.equal(((await extractText({ name: "a.txt", bytes: Buffer.alloc(0) })) as any).error, "empty");
    assert.equal(((await extractText({ name: "a.txt", bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 97) })) as any).error, "too_large");
    assert.equal(((await extractText({ name: "a.pdf", bytes: Buffer.from("not a pdf") })) as any).error, "unreadable");
    assert.equal(((await extractText({ name: "a.docx", bytes: Buffer.from("not a zip") })) as any).error, "unreadable");
    assert.equal(((await extractText({ name: "a.txt", bytes: Buffer.alloc(2000, 0) })) as any).error, "unsupported");
    assert.equal(((await extractText({ name: "a.txt", bytes: Buffer.from("   \n  ") })) as any).error, "empty");
  });

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
  process.exit(failed ? 1 : 0);
})();
