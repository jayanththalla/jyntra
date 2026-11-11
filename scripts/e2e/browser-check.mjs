// Responsive + smoke check in a real headless Chromium. NOT part of `npm test` (needs a browser and a running app).
//   npm i --no-save puppeteer-core @sparticuz/chromium      (or point CHROME_PATH at an installed Chrome)
//   BASE_URL=http://localhost:3000 SESSION_TOKEN=<users.token cookie value> node scripts/e2e/browser-check.mjs
// Per page and width it reports: horizontal overflow, console/page errors, interactive elements smaller than
// 24x24 CSS px (WCAG 2.2 minimum target size), cumulative layout shift, and writes screenshots to ./shots.
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.SESSION_TOKEN;
const PAGES = (process.env.PAGES ?? "/dashboard,/startups,/startups/1,/jobs,/applications,/news,/settings,/outreach/1").split(",");
const WIDTHS = (process.env.WIDTHS ?? "360,390,768,1024,1440,1920").split(",").map(Number);
const SHOTS = process.env.SHOTS_DIR ?? "shots";
fs.mkdirSync(SHOTS, { recursive: true });

let executablePath = process.env.CHROME_PATH;
let args = ["--no-sandbox"];
if (!executablePath) {
  const { default: chromium } = await import("@sparticuz/chromium");
  executablePath = await chromium.executablePath();
  args = chromium.args;
}
const browser = await puppeteer.launch({ executablePath, args, headless: "shell" });
const rows = [];
for (const width of WIDTHS) {
  for (const path of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width < 700 ? 800 : 900, deviceScaleFactor: 1 });
    if (TOKEN) await page.setCookie({ name: "sf_uid", value: TOKEN, url: BASE });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 120)));
    await page.evaluateOnNewDocument(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE + path, { waitUntil: "networkidle0", timeout: 45000 }).catch((e) => errors.push("nav: " + e.message.slice(0, 80)));
    await new Promise((r) => setTimeout(r, 700));
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const offenders = [...document.querySelectorAll("main *")].filter((el) => { const r = el.getBoundingClientRect(); return visible(el) && r.right > de.clientWidth + 1 && !el.closest(".overflow-x-auto,.no-scrollbar"); }).slice(0, 3).map((e) => e.tagName.toLowerCase() + "." + String(e.className).slice(0, 40));
      const small = [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button],[role=tab]")].filter((el) => {
        if (!visible(el) || el.closest("[aria-hidden=true]") || el.closest(".sr-only") || el.classList.contains("sr-only")) return false; // skip links etc. are visually hidden until focused
        // Radios/checkboxes with a clickable <label> are operated through the label, so the label's box is the target.
        const lab = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        const r = ["radio", "checkbox", "switch"].includes(el.getAttribute("role") ?? "") && lab ? lab.getBoundingClientRect() : el.getBoundingClientRect();
        if (el.tagName === "A" && el.closest("p,li,span") && getComputedStyle(el).display === "inline") return false; // inline text links are exempt
        return r.width < 24 || r.height < 24;
      }).slice(0, 5).map((e) => { const r = e.getBoundingClientRect(); return `${(e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || e.tagName).trim().slice(0, 22)} [${e.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}]`; });
      return { overflow: de.scrollWidth > de.clientWidth, offenders, small, cls: Number((window.__cls ?? 0).toFixed(3)), h1: document.querySelector("h1")?.textContent?.trim().slice(0, 36) ?? null, text: document.body.innerText.length };
    });
    rows.push({ width, path, ...m, errors });
    if (["/dashboard", "/startups", "/startups/1", "/jobs", "/outreach/1"].includes(path)) await page.screenshot({ path: `${SHOTS}/${width}${path.replace(/[/?=]/g, "_")}.png` });
    await page.close();
  }
}
await browser.close();
let bad = 0;
for (const r of rows) {
  const flags = [r.overflow && "OVERFLOW", r.errors.length && "ERRORS", r.small.length && `SMALL(${r.small.length})`, r.cls > 0.1 && `CLS=${r.cls}`, !r.h1 && "NO-H1"].filter(Boolean);
  if (flags.length) bad++;
  console.log(`${String(r.width).padEnd(5)} ${r.path.padEnd(16)} ${flags.length ? flags.join(" ") : "ok"}${r.offenders.length ? "  offenders: " + r.offenders.join(" | ") : ""}${r.small.length ? "  small: " + r.small.join(" | ") : ""}${r.errors.length ? "  " + r.errors.join(" ; ") : ""}  cls=${r.cls}`);
}
console.log(`\n${rows.length} page/width combinations, ${rows.length - bad} clean, ${bad} with findings`);
process.exit(bad ? 1 : 0);
