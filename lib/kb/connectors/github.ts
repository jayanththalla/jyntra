// GitHub connector. Reads repositories the user permits (public by default; private only with includePrivate and a
// token). Retrieval-oriented: README, manifests, a repo summary, a bounded set of source files, the user's PRs and
// issues, and commit messages. Repository code is only ever READ as text, never executed.
import { kbFetch, kbJson } from "../http";
import { isExcludedPath, isIndexablePath, redactSecrets } from "../safety";
import { SourceError, type Connector, type RawDoc, type SyncContext, type SyncResult } from "../types";

const API = "https://api.github.com";

const headers = (token?: string | null) => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Jyntra-KB",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

// ---------- OAuth helpers ----------
export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; includePrivate?: boolean }): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    state: o.state,
    scope: o.includePrivate ? "read:user repo" : "read:user",
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${p}`;
}

export async function exchangeCode(o: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<{ token: string; scope: string }> {
  const res = await kbFetch("https://github.com/login/oauth/access_token", {
    fetchImpl: o.fetchImpl,
    method: "POST",
    retries: 0,
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Jyntra-KB" },
    body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; scope?: string; error?: string } | null;
  if (!data?.access_token) throw new SourceError("unauthorized", "GitHub did not grant access (the code may have expired).");
  return { token: data.access_token, scope: data.scope ?? "" };
}

/** Confirms the token works and returns who it belongs to and its scopes. Call before showing a source as connected. */
export async function verifyToken(token: string, fetchImpl?: typeof fetch): Promise<{ login: string; scopes: string[] }> {
  const res = await kbFetch(`${API}/user`, { fetchImpl, headers: headers(token), retries: 1 });
  const u = (await res.json().catch(() => null)) as { login?: string } | null;
  if (!u?.login) throw new SourceError("unauthorized", "GitHub did not return an account for this token.");
  return { login: u.login, scopes: (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
}

// ---------- technology normalisation ----------
const TECH: Record<string, string> = {
  next: "Next.js", react: "React", "react-dom": "React", vue: "Vue", nuxt: "Nuxt", svelte: "Svelte", "@angular/core": "Angular",
  express: "Express", fastify: "Fastify", "@nestjs/core": "NestJS", koa: "Koa", typescript: "TypeScript", tailwindcss: "Tailwind CSS",
  pg: "PostgreSQL", postgres: "PostgreSQL", psycopg2: "PostgreSQL", "psycopg2-binary": "PostgreSQL", asyncpg: "PostgreSQL", mongoose: "MongoDB", mongodb: "MongoDB", pymongo: "MongoDB",
  redis: "Redis", ioredis: "Redis", mysql: "MySQL", mysql2: "MySQL", sqlite3: "SQLite", "better-sqlite3": "SQLite", prisma: "Prisma", "@prisma/client": "Prisma",
  sequelize: "Sequelize", typeorm: "TypeORM", sqlalchemy: "SQLAlchemy", django: "Django", flask: "Flask", fastapi: "FastAPI", numpy: "NumPy", pandas: "Pandas",
  torch: "PyTorch", pytorch: "PyTorch", tensorflow: "TensorFlow", "scikit-learn": "scikit-learn", openai: "OpenAI API", anthropic: "Anthropic API", "@anthropic-ai/sdk": "Anthropic API",
  "@google/generative-ai": "Gemini API", "groq-sdk": "Groq API", langchain: "LangChain", jest: "Jest", vitest: "Vitest", pytest: "pytest", mocha: "Mocha", cypress: "Cypress", playwright: "Playwright",
  "@playwright/test": "Playwright", graphql: "GraphQL", "socket.io": "Socket.IO", "aws-sdk": "AWS", boto3: "AWS", firebase: "Firebase", stripe: "Stripe", nodemailer: "Nodemailer",
  docker: "Docker", "spring-boot-starter-web": "Spring Boot", gin: "Gin", "github.com/gin-gonic/gin": "Gin", tokio: "Tokio", actix: "Actix", "actix-web": "Actix", serde: "Serde", rails: "Ruby on Rails", laravel: "Laravel",
};

const techOf = (name: string): string | null => TECH[name.toLowerCase()] ?? TECH[name.toLowerCase().replace(/^.*\//, "")] ?? null;

export function parseManifest(path: string, text: string): string[] {
  const names = new Set<string>();
  const add = (n: string) => {
    const t = techOf(n);
    if (t) names.add(t);
  };
  const base = path.split("/").pop() ?? path;
  try {
    if (base === "package.json") {
      const j = JSON.parse(text);
      for (const k of ["dependencies", "devDependencies", "peerDependencies"]) for (const d of Object.keys(j[k] ?? {})) add(d);
      if (j.devDependencies?.typescript || j.dependencies?.typescript) names.add("TypeScript");
      names.add("Node.js");
    } else if (base === "requirements.txt" || base === "pyproject.toml") {
      for (const m of text.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)\s*(?:[=<>~!\[;"',]|$)/gm)) add(m[1]);
      names.add("Python");
    } else if (base === "go.mod") {
      for (const m of text.matchAll(/^\s*(?:require\s+)?([a-z0-9./_-]+)\s+v[\d.]+/gim)) add(m[1]);
      names.add("Go");
    } else if (base === "Cargo.toml") {
      for (const m of text.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)) add(m[1]);
      names.add("Rust");
    } else if (base === "pom.xml") {
      for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) add(m[1]);
      names.add("Java");
    } else if (base === "composer.json") {
      const j = JSON.parse(text);
      for (const d of Object.keys({ ...(j.require ?? {}), ...(j["require-dev"] ?? {}) })) add(d);
      if (/laravel/i.test(text)) names.add("Laravel");
      names.add("PHP");
    }
  } catch {
    /* unreadable manifest: no technologies, still stored as a document */
  }
  return [...names].sort();
}

const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "composer.json"];

// ---------- file selection ----------
export function filePriority(path: string): number {
  const p = path.toLowerCase();
  if (/^(docs?|documentation)\//.test(p) || /(architecture|design|adr|contributing)\b.*\.(md|mdx|rst|txt)$/.test(p)) return 0;
  if (/(^|\/)(dockerfile|docker-compose\.ya?ml|render\.yaml|vercel\.json|fly\.toml|\.github\/workflows\/)/.test(p)) return 1;
  if (/(schema|migrations?)\b|\.sql$/.test(p)) return 2;
  if (/(^|\/)(src\/)?(index|main|app|server)\.[a-z]+$/.test(p) || /^(src\/)?app\/(layout|page)\.[a-z]+$/.test(p)) return 3;
  if (/(^|\/)(routes?|api|controllers?|handlers?)\//.test(p)) return 4;
  if (/(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p)) return 5;
  if (/(^|\/)(lib|services?|models?|core)\//.test(p)) return 6;
  return 7;
}

export function pickFiles(tree: { path: string; size?: number; type: string }[], max: number, maxBytes: number) {
  return tree
    .filter((e) => e.type === "blob" && isIndexablePath(e.path) && !MANIFESTS.includes(e.path) && !/^readme(\.|$)/i.test(e.path) && (e.size ?? 0) <= maxBytes && (e.size ?? 1) > 0)
    .sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))
    .slice(0, max);
}

const b64 = (s: string) => Buffer.from(s.replace(/\n/g, ""), "base64").toString("utf8");

interface Repo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  stargazers_count?: number;
  language: string | null;
  topics?: string[];
  owner: { login: string };
}


async function syncRepo(r: Repo, ctx: SyncContext, h: Record<string, string>, me: string | null, docs: RawDoc[], warn: (s: string) => void, maxFiles = ctx.limits.maxFilesPerRepo) {
  const get = <T>(path: string) => kbJson<T>(`${API}/repos/${r.full_name}${path}`, { fetchImpl: ctx.fetchImpl, headers: h });
  const baseMeta = (extra: Record<string, unknown> = {}) => ({ language: r.language, private: r.private, ...extra });

  let languages: Record<string, number> = {};
  try {
    languages = await get<Record<string, number>>("/languages");
  } catch (e) {
    if (e instanceof SourceError && e.code === "rate_limited") throw e;
  }
  const techs = new Set<string>(Object.keys(languages));

  // Manifests first, so technologies can be attached to every doc of this project.
  const manifestDocs: RawDoc[] = [];
  let tree: { path: string; size?: number; type: string }[] = [];
  try {
    const t = await get<{ tree: typeof tree; truncated?: boolean }>(`/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`);
    tree = t.tree ?? [];
  } catch (e) {
    if (e instanceof SourceError && (e.code === "rate_limited" || e.code === "unauthorized")) throw e;
    warn(`${r.full_name}: file list unavailable`);
  }
  const rootManifests = tree.length ? tree.filter((e) => e.type === "blob" && MANIFESTS.includes(e.path)).map((e) => e.path) : [];
  const readFile = async (path: string): Promise<string | null> => {
    try {
      const f = await get<{ content?: string; encoding?: string; size?: number }>(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(r.default_branch)}`);
      if (f.encoding !== "base64" || !f.content || (f.size ?? 0) > ctx.limits.maxFileBytes) return null;
      return b64(f.content);
    } catch (e) {
      if (e instanceof SourceError && (e.code === "rate_limited" || e.code === "unauthorized")) throw e;
      return null;
    }
  };
  for (const path of rootManifests) {
    const text = await readFile(path);
    if (text == null) continue;
    const tech = parseManifest(path, text);
    tech.forEach((x) => techs.add(x));
    manifestDocs.push({
      externalId: `${r.full_name}:${path}`, docType: "manifest", title: `${r.name}/${path}`, url: `${r.html_url}/blob/${r.default_branch}/${path}`,
      content: redactSecrets(text.slice(0, ctx.limits.maxFileBytes)).text, project: r.name, modifiedAt: r.pushed_at, metadata: baseMeta({ path, technologies: tech }),
    });
  }
  const technologies = [...techs].sort();

  // Summary
  docs.push({
    externalId: `${r.full_name}:#summary`, docType: "doc", title: `${r.name}: repository summary`, url: r.html_url, project: r.name, modifiedAt: r.pushed_at,
    content: redactSecrets(
      [`Repository: ${r.full_name}${r.private ? " (private)" : ""}`, r.description ? `Description: ${r.description}` : "", r.topics?.length ? `Topics: ${r.topics.join(", ")}` : "",
        Object.keys(languages).length ? `Languages (bytes): ${Object.entries(languages).map(([k, v]) => `${k} ${v}`).join(", ")}` : r.language ? `Main language: ${r.language}` : "",
        technologies.length ? `Technologies detected from manifests and languages: ${technologies.join(", ")}` : "", `Stars: ${r.stargazers_count ?? 0}`, r.pushed_at ? `Last pushed: ${r.pushed_at}` : ""]
        .filter(Boolean).join("\n")
    ).text,
    metadata: baseMeta({ technologies, topics: r.topics ?? [] }),
  });
  docs.push(...manifestDocs.map((d) => ({ ...d, metadata: { ...d.metadata, projectTechnologies: technologies } })));

  // README
  try {
    const rd = await get<{ content?: string; path?: string; html_url?: string; size?: number }>("/readme");
    if (rd.content) docs.push({ externalId: `${r.full_name}:${rd.path ?? "README.md"}`, docType: "readme", title: `${r.name}: README`, url: rd.html_url ?? `${r.html_url}#readme`, content: redactSecrets(b64(rd.content).slice(0, ctx.limits.maxFileBytes)).text, project: r.name, modifiedAt: r.pushed_at, metadata: baseMeta({ path: rd.path ?? "README.md", technologies }) });
  } catch (e) {
    if (e instanceof SourceError && (e.code === "rate_limited" || e.code === "unauthorized")) throw e;
  }

  // Source files
  // Files are read a few at a time (they are the bulk of the requests); order is kept so syncs stay deterministic.
  const picked = pickFiles(tree, maxFiles, ctx.limits.maxFileBytes).filter((f) => !isExcludedPath(f.path));
  const texts: (string | null)[] = new Array(picked.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, picked.length) }, async () => {
      while (next < picked.length && !ctx.cancelled()) {
        const i = next++;
        texts[i] = await readFile(picked[i].path);
      }
    })
  );
  picked.forEach((f, i) => {
    const text = texts[i];
    if (!text || /\u0000/.test(text)) return;
    const isDoc = /\.(md|mdx|rst|txt)$/i.test(f.path);
    docs.push({ externalId: `${r.full_name}:${f.path}`, docType: isDoc ? "doc" : "code", title: `${r.name}/${f.path}`, url: `${r.html_url}/blob/${r.default_branch}/${f.path}`, content: redactSecrets(text).text, project: r.name, modifiedAt: r.pushed_at, metadata: baseMeta({ path: f.path, technologies }) });
  });

  // Commits (messages only)
  try {
    const cs = await get<{ sha: string; commit: { message: string; author?: { date?: string } } }[]>("/commits?per_page=30");
    if (cs.length)
      docs.push({
        externalId: `${r.full_name}:#commits`, docType: "commits", title: `${r.name}: recent commits`, url: `${r.html_url}/commits/${r.default_branch}`, project: r.name, modifiedAt: cs[0].commit.author?.date ?? r.pushed_at,
        content: redactSecrets(cs.map((c) => `${(c.commit.author?.date ?? "").slice(0, 10)} ${c.sha.slice(0, 7)} ${c.commit.message.split("\n")[0].slice(0, 160)}`).join("\n")).text, metadata: baseMeta({ technologies }),
      });
  } catch (e) {
    if (e instanceof SourceError && (e.code === "rate_limited" || e.code === "unauthorized")) throw e;
  }

  // The user's own PRs and issues in this repo
  if (me) {
    for (const kind of ["pr", "issue"] as const) {
      try {
        const q = encodeURIComponent(kind === "pr" ? `repo:${r.full_name} is:pr is:merged author:${me}` : `repo:${r.full_name} is:issue is:open author:${me}`);
        const res = await kbJson<{ items: { number: number; title: string; body?: string | null; html_url: string; updated_at: string }[] }>(`${API}/search/issues?q=${q}&per_page=10&sort=updated`, { fetchImpl: ctx.fetchImpl, headers: h });
        for (const it of res.items ?? [])
          docs.push({ externalId: `${r.full_name}:${kind}#${it.number}`, docType: kind === "pr" ? "pull_request" : "issue", title: `${r.name} ${kind === "pr" ? "PR" : "issue"} #${it.number}: ${it.title}`.slice(0, 200), url: it.html_url, project: r.name, modifiedAt: it.updated_at, content: redactSecrets(`${it.title}\n\n${(it.body ?? "").slice(0, 4000)}`).text, metadata: baseMeta({ technologies }) });
      } catch (e) {
        if (e instanceof SourceError && (e.code === "rate_limited" || e.code === "unauthorized")) throw e;
      }
    }
  }
}

export const githubConnector: Connector = {
  async probe(ctx) {
    const cfg = ctx.config as { login?: string; includePrivate?: boolean };
    const path = ctx.token && cfg.includePrivate ? "/user/repos?sort=pushed&per_page=1&affiliation=owner" : cfg.login ? `/users/${encodeURIComponent(cfg.login)}/repos?sort=pushed&per_page=1&type=owner` : null;
    if (!path) return { latestChangeAt: null };
    const res = await kbFetch(`${API}${path}`, { fetchImpl: ctx.fetchImpl, headers: headers(ctx.token), retries: 0, timeoutMs: 6_000 });
    const rows = (await res.json().catch(() => null)) as { pushed_at?: string }[] | null;
    const at = Array.isArray(rows) ? rows[0]?.pushed_at : null;
    return { latestChangeAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null };
  },
  provider: "github",
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const warnings: string[] = [];
    const docs: RawDoc[] = [];
    const h = headers(ctx.token);
    const cfg = ctx.config as { login?: string; repos?: string[]; includePrivate?: boolean };
    const allow = new Set((cfg.repos ?? []).map((x) => x.toLowerCase()));
    let me: string | null = null;
    if (ctx.token) {
      try {
        me = (await kbJson<{ login: string }>(`${API}/user`, { fetchImpl: ctx.fetchImpl, headers: h, retries: 1 })).login;
      } catch (e) {
        if (e instanceof SourceError && e.code === "unauthorized") throw new SourceError("revoked", "GitHub access was revoked or the token expired. Reconnect GitHub.");
        throw e;
      }
    }
    const login = me ?? cfg.login;
    if (!login) throw new SourceError("invalid", "Provide a GitHub username or connect your account.");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) throw new SourceError("invalid", "That doesn't look like a GitHub username.");

    const listUrl = ctx.token ? `${API}/user/repos?affiliation=owner&sort=pushed&per_page=100` : `${API}/users/${login}/repos?sort=pushed&per_page=100&type=owner`;
    let all: Repo[] = [];
    try {
      for (let page = 1; page <= 5; page++) {
        const batch = await kbJson<Repo[]>(`${listUrl}&page=${page}`, { fetchImpl: ctx.fetchImpl, headers: h });
        all = all.concat(batch);
        if (batch.length < 100) break;
      }
    } catch (e) {
      if (e instanceof SourceError && e.code === "not_found") throw new SourceError("not_found", "GitHub user not found.");
      throw e;
    }
    const wanted = all.filter((r) => (allow.size ? allow.has(r.full_name.toLowerCase()) : !r.fork && !r.archived));
    const skippedForks = allow.size ? 0 : all.filter((r) => r.fork).length;
    const skippedArchived = allow.size ? 0 : all.filter((r) => !r.fork && r.archived).length;
    const skippedPrivate = wanted.filter((r) => r.private && !cfg.includePrivate).length;
    const eligible = wanted.filter((r) => cfg.includePrivate || !r.private);
    const repos = eligible.slice(0, ctx.limits.maxRepos);
    // Say what was left out, so a short project list is explained rather than silent.
    const left: string[] = [];
    if (skippedForks) left.push(`${skippedForks} forked`);
    if (skippedArchived) left.push(`${skippedArchived} archived`);
    if (skippedPrivate) left.push(`${skippedPrivate} private (connect GitHub with private access to include them)`);
    if (eligible.length > repos.length) left.push(`${eligible.length - repos.length} beyond the ${ctx.limits.maxRepos}-repository limit`);
    warnings.push(`Indexing ${repos.length} of ${all.length} repositories${left.length ? `; not included: ${left.join(", ")}` : ""}.`);
    // Without a token GitHub allows only 60 requests an hour, which is about one or two repositories at full depth.
    // Read fewer files per repository so more repositories fit; connecting GitHub removes the limit.
    const unauth = !ctx.token;
    if (unauth) warnings.push("Not signed in to GitHub, so GitHub's 60-requests-an-hour limit applies. Connect your GitHub account to index every repository.");

    let complete = true;
    for (const r of repos) {
      if (ctx.cancelled()) {
        warnings.push("Cancelled before all repositories were read.");
        complete = false;
        break;
      }
      if (docs.length >= ctx.limits.maxDocs) {
        warnings.push("Document limit reached; some repositories were not indexed.");
        complete = false;
        break;
      }
      const mark = docs.length;
      try {
        await syncRepo(r, ctx, h, me, docs, (w) => warnings.push(w), unauth ? Math.min(6, ctx.limits.maxFilesPerRepo) : ctx.limits.maxFilesPerRepo);
      } catch (e) {
        if (e instanceof SourceError && e.code === "rate_limited") {
          warnings.push("GitHub's rate limit was reached; the rest will be indexed on the next sync.");
          docs.length = mark; // a half-read repo would look complete; drop its partial docs
          complete = false;
          break;
        }
        if (e instanceof SourceError && e.code === "unauthorized") throw new SourceError("revoked", "GitHub access was revoked. Reconnect GitHub.");
        docs.length = mark;
        warnings.push(`${r.full_name}: could not be read`);
        complete = false;
      }
    }
    ctx.log(`github: ${docs.length} documents from ${repos.length} repositories`);
    return { docs, complete, warnings };
  },
};
