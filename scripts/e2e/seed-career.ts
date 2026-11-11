// Seeds a throw-away database for scripts/e2e/career-browser.mjs. Prints the session cookie value.
//   DATABASE_URL=postgres://…/jyntra_e2e npx tsx scripts/e2e/seed-career.ts
import { Client } from "pg";
async function main() {
  const base = process.env.DATABASE_URL!;
  const name = new URL(base).pathname.slice(1);
  const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const { query, pool } = await import("@/lib/database");
  const users = await import("@/lib/users");
  const conv = await import("@/lib/kb/conversations");
  const { user, sessionToken } = await users.createUser({ name: "Asha Rao", skills: ["Python", "React"], target_roles: ["Backend Engineer"], tech_experience_years: 2, projects: [], github_url: "https://github.com/asha" } as any);
  for (let i = 0; i < 14; i++) await query("INSERT INTO kb_sources (user_id, provider, label, status, config) VALUES ($1,'github',$2,'connected','{}')", [user.id, `GitHub: repo-owner-${i}`]);
  const long = "This project uses Next.js and PostgreSQL. ".repeat(40);
  let id: number | null = null;
  for (let i = 0; i < 14; i++) id = (await conv.saveExchange(user.id, { conversationId: id, mode: "auto", question: `Question ${i}: explain part ${i} of my shop project`, answer: `Answer ${i}. ${long}`, citations: [], meta: { grounded: false } })).conversationId;
  const rows = Array.from({ length: 12 }, (_, i) => `| ${i + 1} | **project-${i}** | A deliberately long purpose sentence that explains what this project does for its users and why it exists. [S1][S2] | Next.js, PostgreSQL, Redis, Docker | Repository found |`).join("\n");
  const table = `You have **12** distinct projects across your knowledge base.\n\n| # | Project | Purpose | Technologies | Evidence |\n|---|---|---|---|---|\n${rows}`;
  await conv.saveExchange(user.id, { conversationId: null, mode: "auto", question: "Table check: list all my projects", answer: table, citations: [{ id: "S1", title: "README one", url: null, locator: "x", provider: "github", docType: "readme", documentId: 1, snippet: "s" }, { id: "S2", title: "README two", url: null, locator: "x", provider: "github", docType: "readme", documentId: 2, snippet: "s" }], meta: { grounded: true } });
  const [s] = await query("INSERT INTO startups (name, normalized_name, source) VALUES ('Acme','acme','yc') RETURNING id");
  await query("INSERT INTO applications (user_id, startup_id) VALUES ($1,$2)", [user.id, s.id]);
  console.log(sessionToken);
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
