// End-to-end smoke test against a RUNNING production server (real HTTP, real cookie, real PDF/DOCX upload).
//   DATABASE_URL=… npm run build && DATABASE_URL=… npx next start -p 3111 &   then   DATABASE_URL=… npx tsx scripts/smoke-interview-v2.ts
// Needs a reachable PostgreSQL. No AI or realtime key is required: it asserts the honest "not configured" behaviour.
import fs from "node:fs";
import PDFDocument from "pdfkit";
(async () => {
  const { createUser } = await import("@/lib/users");
  const { sessionToken } = await createUser({ name: "Smoke", skills: ["Python"], target_roles: ["Backend"], tech_experience_years: 1, projects: [] } as any);
  const { sessionToken: other } = await createUser({ name: "Other", skills: ["Go"], target_roles: ["Backend"], tech_experience_years: 1, projects: [] } as any);
  const B = "http://localhost:3111";
  const H = (t: string) => ({ Cookie: `sf_uid=${t}`, Origin: B });
  const J = async (m: string, u: string, t: string, body?: unknown) => { const r = await fetch(B + u, { method: m, headers: { ...H(t), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j: any = null; try { j = await r.clone().json(); } catch {} return { status: r.status, j, r }; };
  const ok = (c: boolean, m: string) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) process.exitCode = 1; };

  console.log("auth");
  ok((await fetch(B + "/api/interview/sessions/v2")).status === 401, "no cookie → 401 on sessions");
  ok((await fetch(B + "/api/interview/sessions/pdf?id=1")).status === 401, "no cookie → 401 on pdf");
  const caps = await J("GET", "/api/voice/capabilities", sessionToken); ok(caps.status === 200 && caps.j.realtime.configured === false && /OPENAI_API_KEY/.test(caps.j.realtime.reason), "capabilities reports realtime NOT configured with the reason (no key in this environment)");
  const rt = await J("POST", "/api/voice/sessions/1/realtime-token", sessionToken); ok([404, 503].includes(rt.status), `realtime-token without a session/key is refused (${rt.status})`);

  console.log("resume upload (real files, real parser)");
  const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync("/tmp/resume.docx")]), "resume.docx");
  let r = await fetch(B + "/api/interview/resume", { method: "POST", headers: H(sessionToken), body: fd }); let j: any = await r.json();
  ok(r.status === 200 && j.kind === "docx" && j.profile.name === "Priya Sharma", `DOCX parsed (${j.profile?.name}, skills: ${j.profile?.skills?.join(",")})`);
  ok(j.profile.internships.length === 1 && j.profile.projects.length === 2 && j.roles.some((x: any) => x.role === "Backend Developer"), "internship, 2 projects and a Backend role recommendation");
  ok(!JSON.stringify(j).includes("example.com") && !JSON.stringify(j).includes("98765"), "contact details not returned");
  const pdfDoc = new PDFDocument(); const chunks: Buffer[] = []; pdfDoc.on("data", (c) => chunks.push(c)); const done = new Promise<void>((res) => pdfDoc.on("end", () => res()));
  pdfDoc.fontSize(14).text("Rahul Verma"); pdfDoc.text("SKILLS"); pdfDoc.text("Python, Django, PostgreSQL, Docker"); pdfDoc.text("PROJECTS"); pdfDoc.text("Chat App"); pdfDoc.text("- Built with Node.js and React"); pdfDoc.end(); await done;
  const fd2 = new FormData(); fd2.append("file", new Blob([Buffer.concat(chunks)]), "cv.pdf"); r = await fetch(B + "/api/interview/resume", { method: "POST", headers: H(sessionToken), body: fd2 }); j = await r.json();
  ok(r.status === 200 && j.kind === "pdf" && j.profile.skills.includes("Django"), `PDF parsed (skills: ${j.profile?.skills?.join(",")})`);
  const fd3 = new FormData(); fd3.append("file", new Blob([Buffer.from("MZ not a resume")]), "resume.pdf"); r = await fetch(B + "/api/interview/resume", { method: "POST", headers: H(sessionToken), body: fd3 }); ok(r.status === 415, `fake .pdf (EXE bytes) rejected by content: ${r.status}`);
  const fd4 = new FormData(); fd4.append("file", new Blob([Buffer.alloc(6 * 1024 * 1024, 65)]), "big.pdf"); r = await fetch(B + "/api/interview/resume", { method: "POST", headers: H(sessionToken), body: fd4 }); ok([413, 415].includes(r.status), `6 MB file rejected: ${r.status}`);
  const save = await J("PUT", "/api/interview/resume", sessionToken, { profile: j.profile }); ok(save.status === 200 && save.j.id > 0, "reviewed profile saved");
  const got = await J("GET", "/api/interview/resume", sessionToken); ok(got.j.confirmed === true && got.j.profile.skills.includes("Django"), "saved profile is reused");
  const mine = await J("GET", "/api/interview/resume", other); ok(mine.j.profile === null, "another user does not see it");

  console.log("formal session, pause/resume, ownership");
  const Q = [{ id: "q1", text: "Explain how a hash table handles collisions in detail?", focus: "x" }, { id: "q2", text: "How would you debug a slow query in production?", focus: "y" }, { id: "q3", text: "What is the difference between a process and a thread?", focus: "z" }];
  const c = await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "create_formal", minutes: 10, type: "technical", level: "junior", role: "Backend Developer", questions: Q }); ok(c.status === 200 && c.j.session_id, "formal session created");
  const sid = c.j.session_id;
  ok((await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "create_formal", minutes: 10, type: "technical", level: "junior", questions: Q })).status === 409, "a second open session is refused");
  const open = await J("GET", "/api/interview/sessions/v2", sessionToken); ok(open.j.session?.id === sid && open.j.session.status === "active", "open session is found after 'refresh'");
  ok((await J("GET", "/api/interview/sessions/v2", other)).j.session === null, "other user sees no session");
  ok((await J("POST", "/api/interview/sessions/v2", other, { action: "pause", session_id: sid })).status === 409, "other user cannot pause it");
  const ev = await J("POST", "/api/interview/evaluate", sessionToken, { session_id: sid, question_id: "q1", answer: "A hash table maps keys to buckets and collisions are handled by chaining or open addressing so lookups stay fast." }); ok(ev.j.ok === false && ev.j.error === "not_configured" && !("feedback" in ev.j), `no AI key → honest 'not_configured', no score invented (${ev.j.error})`);
  const noscore = await J("POST", "/api/interview/evaluate", sessionToken, { session_id: sid, question_id: "q1", answer: "asdf asdf asdf asdf asdf asdf asdf asdf" }); ok(noscore.j.feedback?.score === 0, "gibberish scores 0 locally");
  ok((await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "pause", session_id: sid })).status === 200, "paused");
  ok((await J("POST", "/api/interview/evaluate", sessionToken, { session_id: sid, question_id: "q2", answer: "x".repeat(60) })).status === 409, "answers are refused while paused");
  ok((await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "complete", session_id: sid })).status === 409, "a paused session cannot be completed");
  ok((await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "resume", session_id: sid })).status === 200, "resumed");

  console.log("written tests + SQL (production bundle)");
  const ws = await J("POST", "/api/interview/written", sessionToken, { action: "start", categories: ["DBMS"], count: 2 }); ok(ws.status === 200 && ws.j.questions.length === 2 && !JSON.stringify(ws.j).includes("explanation"), "written questions delivered without answers/explanations");
  const wsub = await J("POST", "/api/interview/written", sessionToken, { action: "submit", session_id: sid, question_id: "dbms-1", choice: ["d"] }); ok(wsub.j.result.correct === true && wsub.j.result.explanation.length > 10, "graded; answer + explanation revealed after submission");
  const sp = await J("POST", "/api/interview/sql", sessionToken, { action: "problem", problem_id: "sql-second-highest" }); ok(sp.status === 200 && !JSON.stringify(sp.j).includes("OFFSET 1"), "SQL problem shown without the solution");
  const run = await J("POST", "/api/interview/sql", sessionToken, { action: "run", problem_id: "sql-aggregates", sql: "SELECT COUNT(*), MAX(salary) FROM employees" }); ok(run.j.run?.ok === true && JSON.stringify(run.j.run.rows) === "[[8,95000]]", `SQL really executed in the sandbox inside the production build: ${JSON.stringify(run.j.run?.rows)}`);
  const evil = await J("POST", "/api/interview/sql", sessionToken, { action: "run", problem_id: "sql-aggregates", sql: "DROP TABLE users" }); ok(evil.j.run?.kind === "rejected", "DROP rejected");
  const t0 = Date.now(); const loop = await J("POST", "/api/interview/sql", sessionToken, { action: "run", problem_id: "sql-aggregates", sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT COUNT(*) FROM c" }); ok(loop.j.run?.kind === "timeout" && Date.now() - t0 < 6000, `runaway query stopped by the timeout (${Date.now() - t0} ms)`);
  const gr = await J("POST", "/api/interview/sql", sessionToken, { action: "grade", session_id: sid, problem_id: "sql-second-highest", sql: "SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1) AS second_highest" }); ok(gr.j.grade?.correct === true && gr.j.grade.total === 3, "correct SQL passes all 3 datasets");
  const fin = await J("POST", "/api/interview/written", sessionToken, { action: "finish", session_id: sid }); ok(fin.j.summary?.answered >= 2 && fin.j.summary.sql?.answered === 1, "written summary saved");

  console.log("report + PDF (production bundle)");
  const comp = await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "complete", session_id: sid }); ok(comp.status === 200 && comp.j.report.kind === "formal" && comp.j.report.questionsAnswered === 1, `report saved (overall ${comp.j.report?.scores?.overall})`);
  const pdf = await fetch(B + `/api/interview/sessions/pdf?id=${sid}`, { headers: H(sessionToken) }); const pb = Buffer.from(await pdf.arrayBuffer()); ok(pdf.status === 200 && pb.subarray(0, 5).toString() === "%PDF-" && pdf.headers.get("content-type") === "application/pdf" && pb.length > 4000, `PDF served (${pb.length} bytes)`);
  fs.writeFileSync("/tmp/smoke.pdf", pb);
  ok((await fetch(B + `/api/interview/sessions/pdf?id=${sid}`, { headers: H(other) })).status === 404, "another user cannot download this PDF");
  ok((await J("POST", "/api/interview/sessions/v2", sessionToken, { action: "complete", session_id: sid })).status === 409, "cannot complete twice");

  console.log("pages");
  for (const p of ["/mock-interview/formal", "/mock-interview/voice", "/mock-interview"]) { const x = await fetch(B + p, { headers: H(sessionToken) }); ok(x.status === 200, `${p} renders (${x.status})`); }
  const home = await fetch(B + "/mock-interview/formal", { headers: H(sessionToken) }); const html = await home.text(); ok(/Formal interview/.test(html), "formal page has its heading");
  const csp = (await fetch(B + "/mock-interview/voice", { headers: H(sessionToken) })).headers.get("content-security-policy") ?? ""; ok(/connect-src[^;]*https:\/\/api\.openai\.com/.test(csp), "CSP allows the WebRTC offer to api.openai.com");
  process.exit(process.exitCode ?? 0);
})();
