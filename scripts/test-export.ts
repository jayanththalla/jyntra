import assert from "node:assert/strict";
import { buildExport, safeFilename, toHtml, toJson, toMarkdown, toText, type ExportMessage } from "../lib/career/export";
import { identityFromClaims, LoginError, newTicket, packTicket, unpackTicket, safeNext, googleLoginConfigured, authorizeUrl } from "../lib/auth/google";
import { dueState, parseDue, validTimezone } from "../lib/career/reminders";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok", name); };
const now = new Date("2026-10-27T10:00:00Z");
const msgs: ExportMessage[] = [
  { role: "user", content: "Explain my project <script>alert(1)</script>" },
  { role: "assistant", content: "# Heading\n**Bold** and [link](https://example.com/a?b=1) and [bad](javascript:alert(1))\n- one\n- two\n```ts\nconst x = 1 < 2;\n```\nతెలుగు text", citations: [{ id: "S1", title: "Repo <b>", url: "https://github.com/a/b" }, { id: "S2", title: "Local", url: "javascript:alert(1)" }] },
];

t("filename is safe and dated", () => {
  assert.equal(safeFilename("Interview Prep: Q&A / ../x", "pdf", now), "career-gpt-interview-prep-q-a-x-2026-10-27.pdf");
  assert.equal(safeFilename("తెలుగు", "md", now), "career-gpt-chat-2026-10-27.md");
});
t("html escapes scripts and refuses non-http links", () => {
  const h = toHtml(msgs, { format: "html", now });
  assert.ok(!h.includes("<script>alert"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(!/href="javascript/i.test(h));
  assert.ok(h.includes('href="https://example.com/a?b=1"'));
  assert.ok(h.includes("Content-Security-Policy"));
  assert.ok(h.includes("const x = 1 &lt; 2;"));
  assert.ok(h.includes("తెలుగు"));
});
t("markdown keeps structure and sources", () => {
  const m = toMarkdown(msgs, { format: "md", now });
  assert.ok(m.includes("## Atlas") && m.includes("**Sources**") && m.includes("[S1] [Repo <b>](https://github.com/a/b)"));
  assert.ok(m.includes("- [S2] Local\n") || m.endsWith("- [S2] Local\n"));
});
t("options remove citations and code", () => {
  const m = toMarkdown(msgs, { format: "md", citations: false, codeBlocks: false, now });
  assert.ok(!m.includes("Sources") && !m.includes("const x") && m.includes("code block omitted"));
});
t("txt has no markdown noise", () => {
  const x = toText(msgs, { format: "txt", now });
  assert.ok(!x.includes("**") && !x.includes("# Heading") && x.includes("link (https://example.com/a?b=1)") && x.includes("YOU:"));
});
t("json is valid, has no unsafe urls", () => {
  const j = JSON.parse(toJson(msgs, { format: "json", now }));
  assert.equal(j.messages.length, 2);
  assert.equal(j.messages[1].citations[1].url, null);
});
t("empty messages are skipped; mime types correct", () => {
  const r = buildExport([{ role: "user", content: "  " }, ...msgs], { format: "json", title: "T", now });
  assert.equal(JSON.parse(r.content).messages.length, 2);
  assert.equal(r.mime, "application/json;charset=utf-8");
  assert.equal(buildExport(msgs, { format: "html", now }).mime, "text/html;charset=utf-8");
  assert.ok(buildExport(msgs, { format: "bogus" as any, now }).filename.endsWith(".md"));
});
t("reminder date parsing", () => {
  assert.equal(parseDue("nope"), null);
  assert.equal(parseDue("1900-01-01T00:00:00Z"), null);
  assert.equal(parseDue(123 as any), null);
  assert.ok(parseDue("2026-11-01T09:00:00.000Z"));
  assert.equal(validTimezone("Asia/Calcutta"), "Asia/Calcutta");
  assert.equal(validTimezone("Not/AZone"), "UTC");
});
t("reminder due states", () => {
  assert.equal(dueState("2026-10-26T10:00:00Z", null, now), "overdue");
  assert.equal(dueState("2026-10-27T18:00:00Z", null, now), "today");
  assert.equal(dueState("2026-10-30T18:00:00Z", null, now), "upcoming");
  assert.equal(dueState("2026-10-26T10:00:00Z", "2026-10-26T11:00:00Z", now), "done");
});
const env = { CREDENTIAL_ENCRYPTION_KEY: "k".repeat(32), GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
t("login: open redirects are refused", () => {
  assert.equal(safeNext("/career-ai/tracker"), "/career-ai/tracker");
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", undefined, "/a\nb"]) assert.equal(safeNext(bad as any), "/career-ai");
});
t("login: ticket cookie is signed and tamper-proof", () => {
  const tk = newTicket("/settings");
  const c = packTicket(tk, env);
  assert.deepEqual(unpackTicket(c, env)?.state, tk.state);
  assert.equal(unpackTicket(c.replace(/^./, (x) => (x === "a" ? "b" : "a")), env), null);
  assert.equal(unpackTicket(c, { ...env, CREDENTIAL_ENCRYPTION_KEY: "z".repeat(32) }), null);
  assert.equal(unpackTicket(undefined, env), null);
  assert.equal(newTicket("https://evil.com").next, "/career-ai");
});
t("login: PKCE + state + nonce are in the Google URL; no gmail scope", () => {
  const tk = newTicket("/");
  const u = new URL(authorizeUrl({ clientId: "cid", redirectUri: "http://x/cb", ticket: tk }));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), tk.state); assert.equal(u.searchParams.get("nonce"), tk.nonce);
  assert.ok(!u.searchParams.get("scope")!.includes("gmail"));
});
t("login: ID token claims are enforced", () => {
  const ok = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000_000_000, nonce: "n1", sub: "123", email: "A@B.com", email_verified: true, name: "Asha <b>" };
  const o = { clientId: "cid", nonce: "n1", now: 1_900_000_000_000 };
  assert.deepEqual(identityFromClaims(ok, o), { sub: "123", email: "a@b.com", name: "Asha b" });
  const bad = (c: object, code: string) => assert.throws(() => identityFromClaims({ ...ok, ...c }, o), (e: any) => e instanceof LoginError && e.code === code);
  bad({ iss: "https://evil.com" }, "bad_token"); bad({ aud: "other" }, "bad_token"); bad({ exp: 1_000 }, "bad_token"); bad({ nonce: "x" }, "bad_token"); bad({ sub: "" }, "bad_token");
  bad({ email_verified: false }, "unverified_email"); bad({ email_verified: "true" }, "unverified_email");
});
t("login: only configured when id, secret and a real key exist", () => {
  assert.equal(googleLoginConfigured(env), true);
  assert.equal(googleLoginConfigured({ ...env, CREDENTIAL_ENCRYPTION_KEY: "short" }), false);
  assert.equal(googleLoginConfigured({ ...env, GOOGLE_CLIENT_ID: "" }), false);
});
console.log(`${n} export/reminder checks passed`);
