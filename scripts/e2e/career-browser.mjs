// Real-browser checks for the Career GPT screens (layout, scrolling, applications flow, email preview). NOT part of `npm test`.
//   DATABASE_URL=…/jyntra_e2e npx tsx scripts/e2e/seed-career.ts   -> prints the session token
//   next start -p 3100 (same DATABASE_URL)  then:  BASE_URL=http://localhost:3100 SESSION_TOKEN=<token> node scripts/e2e/career-browser.mjs
// Uses Playwright (set PLAYWRIGHT_MODULE if it is not resolvable). It never sends an email and never calls an AI provider.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TOKEN = process.env.SESSION_TOKEN;
const SHOTS = process.env.SHOTS_DIR ?? "shots";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

const browser = await chromium.launch();
for (const width of [375, 768, 1280]) {
  const height = width < 700 ? 800 : 860;
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addCookies([{ name: "sf_uid", value: TOKEN, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));
  const known = [];
  page.on("console", (m) => {
    if (m.type() !== "error" || /Failed to load resource|hydrat/i.test(m.text())) return;
    // KNOWN, pre-existing: Radix's scroll-lock injects an un-nonced <style> when the mobile Sheet opens (<1024px); the CSP blocks it. Cosmetic.
    if (/Content Security Policy directive 'style-src/.test(m.text())) return void known.push(m.text().slice(0, 60));
    errors.push(m.text().slice(0, 140));
  });
  const tag = `[${width}px]`;
  const noOverflow = async (label) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(`${tag} ${label}: no horizontal scroll`, o <= 1, `(overflow ${o}px)`); };

  // ---- chat ----
  await page.goto(`${BASE}/career-ai`, { waitUntil: "networkidle" });
  await noOverflow("chat");
  { const v = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight })); check(`${tag} chat: the page itself does not scroll vertically`, v.sh <= v.ih + 1, `(page ${v.sh}px vs window ${v.ih}px)`); }
  // open the long conversation through the UI (desktop sidebar or mobile drawer)
  if (width < 1024) await page.getByRole("button", { name: /Sources & history/i }).click();
  await page.getByRole("tab", { name: /Chats/ }).click();
  await page.locator("button:has-text('Question 0')").first().click();
  await page.waitForSelector("text=Answer 13.", { timeout: 8000 });
  await page.waitForTimeout(700);
  // wide project table + many citations: must scroll inside its own box and move nothing else
  if (width < 1024) await page.getByRole("button", { name: /Sources & history/i }).click();
  await page.getByRole("tab", { name: /Chats/ }).click();
  await page.locator("button:has-text('Table check')").first().click();
  await page.waitForSelector("text=12 distinct projects", { timeout: 8000 });
  await page.waitForTimeout(500);
  { const t = await page.evaluate(() => { const tb = document.querySelector('[aria-label="Conversation"] table'); const w = tb?.parentElement; const c = document.querySelector('#kb-q')?.getBoundingClientRect(); return { rows: tb?.querySelectorAll("tbody tr").length, inner: w ? w.scrollWidth >= w.clientWidth : false, pageW: document.documentElement.scrollWidth - innerWidth, pageH: document.documentElement.scrollHeight - innerHeight, composerVisible: !!c && c.bottom <= innerHeight + 1 }; });
    check(`${tag} chat: project table shows all 12 rows`, t.rows === 12, `(${t.rows})`);
    check(`${tag} chat: wide table does not widen or scroll the page`, t.pageW <= 1 && t.pageH <= 1 && t.composerVisible, `(w+${t.pageW}px h+${t.pageH}px, composer visible ${t.composerVisible})`); }
  if (width < 1024) { /* drawer closed by selecting a chat */ }
  if (width < 1024) await page.getByRole("button", { name: /Sources & history/i }).click();
  await page.getByRole("tab", { name: /Chats/ }).click();
  await page.locator("button:has-text('Question 0')").first().click();
  await page.waitForSelector("text=Answer 13.", { timeout: 8000 });
  await page.waitForTimeout(700);
  const msgs = page.locator('[aria-label="Conversation"]');
  const dims = await msgs.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop }));
  check(`${tag} chat: messages scroll inside their own panel`, dims.sh > dims.ch + 50, `(scrollHeight ${dims.sh} > clientHeight ${dims.ch})`);
  check(`${tag} chat: opened conversation follows to the latest message`, dims.top > 0);
  const comp = page.locator("#kb-q");
  const rect = async () => comp.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; });
  const before = await rect();
  check(`${tag} chat: composer is inside the viewport`, before.bottom <= before.vh && before.top > 0, JSON.stringify(before));
  await msgs.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  const after = await rect();
  const pageY = await page.evaluate(() => window.scrollY);
  check(`${tag} chat: composer stays put while messages scroll`, after.top === before.top, `(${before.top} -> ${after.top})`);
  check(`${tag} chat: scrolling the chat does not scroll the page`, pageY === 0, `(scrollY ${pageY})`);
  if (width >= 1024) {
    await page.getByRole("tab", { name: /Sources/ }).click();
    const aside = page.locator('aside[aria-label="Sources, chats and facts"] > div');
    const a = await aside.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    check(`${tag} sources: list is taller than its panel (14 sources)`, a.sh > a.ch, JSON.stringify(a));
    const chatTopBefore = await msgs.evaluate((el) => el.scrollTop);
    await aside.evaluate((el) => { el.scrollTop = 400; });
    const tabsTop = await page.getByRole("tab", { name: /Sources/ }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const chatTopAfter = await msgs.evaluate((el) => el.scrollTop);
    check(`${tag} sources: scrolls independently, tabs stay pinned, chat unaffected`, chatTopBefore === chatTopAfter && tabsTop > 0 && tabsTop < 400, `(tabs top ${tabsTop})`);
  }
  await page.screenshot({ path: `${SHOTS}/chat-${width}.png` });
  // long text typed in the composer does not push it off screen
  await comp.fill("long question ".repeat(300).slice(0, 4000));
  const grown = await rect();
  check(`${tag} chat: a very long draft keeps the composer on screen`, grown.bottom <= grown.vh, JSON.stringify(grown));
  await comp.fill("");

  // ---- applications ----
  await page.goto(`${BASE}/career-ai/applications`, { waitUntil: "networkidle" });
  await noOverflow("applications (empty)");
  await page.getByLabel("Application questions").fill("1. Tell us about yourself (max 12 words)\n2. What are your salary expectations?\n3. Why should we hire you? (max 500 characters)");
  await page.getByRole("button", { name: /Find the questions/ }).click();
  await page.waitForSelector('li[aria-label="Question 3"]');
  const cards = await page.locator('li[aria-label^="Question"]').count();
  check(`${tag} applications: one card per question, in order`, cards === 3);
  check(`${tag} applications: limits shown from the text`, (await page.locator("text=≤ 12 words").count()) === 1 && (await page.locator("text=≤ 500 chars").count()) === 1);
  const q1 = page.locator('li[aria-label="Question 1"]');
  await q1.getByLabel(/Your answer/).fill("I build backend systems and care about clean APIs, tests, careful reviews, and steady delivery in small teams.");
  await q1.getByLabel(/Your answer/).blur();
  await page.waitForTimeout(500);
  check(`${tag} applications: over-limit edit is flagged`, (await q1.locator("text=over the limit").count()) === 1);
  check(`${tag} applications: counts shown`, (await q1.locator("text=/\\d+ words · \\d+ characters/").count()) === 1);
  await page.getByRole("button", { name: /^Generate$/ }).first().click(); // salary card: no confirmed fact -> asks, no AI call
  await page.waitForSelector("text=I need something from you", { timeout: 8000 });
  check(`${tag} applications: salary asks the candidate instead of guessing`, (await page.locator("text=I won't guess a number").count()) === 1);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Tell us about yourself/ }).first().click();
  await page.waitForSelector('li[aria-label="Question 1"]');
  const persisted = await page.locator('li[aria-label="Question 1"]').getByLabel(/Your answer/).inputValue();
  check(`${tag} applications: saved edit reopens after reload`, /backend systems/.test(persisted));
  await noOverflow("applications (cards)");
  await page.screenshot({ path: `${SHOTS}/applications-${width}.png`, fullPage: true });

  // ---- email ----
  await page.goto(`${BASE}/career-ai/email`, { waitUntil: "networkidle" });
  await noOverflow("email (empty)");
  await page.getByRole("button", { name: "Blank" }).click();
  await page.getByLabel("To", { exact: true }).fill("recruiter@example.com");
  await page.getByLabel("Subject").fill("Backend engineer role");
  await page.getByLabel("Body").fill("Hi,\n\nI built a Next.js store and would like to talk about the role.\n\nBest,\nAsha");
  await page.getByRole("button", { name: /Save draft/ }).click();
  await page.waitForSelector("text=Draft saved.");
  const sendBtn = page.getByRole("button", { name: /Preview and send/ });
  check(`${tag} email: sending is disabled until an account is connected`, await sendBtn.isDisabled());
  check(`${tag} email: saving a draft sent nothing`, (await page.locator("text=Sent").count()) >= 0 && (await page.locator("text=Nothing sent from here yet.").count()) === 1);
  await noOverflow("email (draft)");
  await page.screenshot({ path: `${SHOTS}/email-${width}.png`, fullPage: true });
  check(`${tag} no console/page errors`, errors.length === 0, errors.join(" | "));
  if (known.length) console.log(`NOTE  ${tag} ${known.length} known CSP style-src message(s) from the Radix Sheet scroll lock (pre-existing)`);
  await ctx.close();
}
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
