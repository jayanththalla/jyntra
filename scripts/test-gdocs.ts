import assert from "node:assert/strict";
import { docIdFromUrl, gdocsConnector, parseDocLinks } from "../lib/kb/connectors/gdocs";
import { TtlCache } from "../lib/kb/cache";
import { answerQuestion, type AskDeps } from "../lib/kb/answer";
import { SourceError, DEFAULT_LIMITS, type SyncContext } from "../lib/kb/types";

let n = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log("ok", name); };
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const ctx = (fetchImpl: any, docIds = [ID]): SyncContext => ({ userId: 1, sourceId: 1, config: { docIds }, fetchImpl, cancelled: () => false, log: () => {}, limits: DEFAULT_LIMITS });
const resp = (status: number, body = "", type = "text/plain; charset=utf-8", headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": type, ...headers } });

(async () => {
  await t("google docs: only docs.google.com document links are accepted", () => {
    assert.equal(docIdFromUrl(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`), ID);
    assert.equal(docIdFromUrl(`https://docs.google.com/document/u/0/d/${ID}/edit`), ID);
    for (const bad of [`http://docs.google.com/document/d/${ID}`, `https://evil.com/document/d/${ID}`, `https://docs.google.com.evil.com/document/d/${ID}`, `https://user:pw@docs.google.com/document/d/${ID}`, "https://docs.google.com/document/d/short", "https://docs.google.com/spreadsheets/d/" + ID, "not a url"]) assert.equal(docIdFromUrl(bad), null, bad);
    const p = parseDocLinks(`https://docs.google.com/document/d/${ID}/edit, https://example.com/x ${`https://docs.google.com/document/d/${ID}`}`);
    assert.deepEqual(p.ids, [ID]); assert.equal(p.bad.length, 1);
  });
  await t("google docs: imports text from a fixed export URL, no redirects followed", async () => {
    const calls: { url: string; init: any }[] = [];
    const r = await gdocsConnector.sync(ctx(async (url: string, init: any) => (calls.push({ url, init }), resp(200, "Jayanth Thalla\nBackend engineer. Built FastAPI services with Redis caching."))));
    assert.equal(r.docs.length, 1); assert.match(r.docs[0].title, /Jayanth Thalla/); assert.equal(r.complete, true);
    assert.equal(calls[0].url, `https://docs.google.com/document/d/${ID}/export?format=txt`); assert.equal(calls[0].init.redirect, "manual");
  });
  await t("google docs: a private doc (redirect to sign-in) is reported, never followed", async () => {
    await assert.rejects(gdocsConnector.sync(ctx(async () => resp(302, "", "text/html", { location: "https://accounts.google.com/ServiceLogin" }))), (e: any) => e instanceof SourceError && /isn't shared/.test(e.message));
    const mixed = await gdocsConnector.sync(ctx(async (u: string) => (u.includes("export") && u.includes("Bad") ? resp(404) : resp(200, "A readable document with enough text to index.")), [ID, "Bad" + ID]));
    assert.equal(mixed.docs.length, 1); assert.equal(mixed.complete, false); assert.ok(mixed.warnings.length === 1);
  });
  await t("google docs: HTML sign-in pages and 429 are handled", async () => {
    await assert.rejects(gdocsConnector.sync(ctx(async () => resp(200, "<html>sign in</html>", "text/html"))), (e: any) => e instanceof SourceError);
    await assert.rejects(gdocsConnector.sync(ctx(async () => resp(429))), (e: any) => e instanceof SourceError && e.code === "rate_limited");
  });
  await t("cache: ttl expiry and size cap", () => {
    let now = 0;
    const c = new TtlCache<number>(1000, 2, () => now);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    assert.equal(c.get("a"), undefined); assert.equal(c.get("b"), 2);
    now = 1500; assert.equal(c.get("b"), undefined);
  });
  await t("understanding cache: the same message is routed with ONE AI call", async () => {
    let routerCalls = 0;
    const deps: AskDeps = {
      retrieve: async () => [], codingDocs: async () => [], entities: async () => [], projectNames: async () => [], aiConfigured: () => true,
      complete: async (p) => { if (p.includes("router of a career assistant")) { routerCalls++; return { text: '{"type":"general"}', provider: "groq" }; } return { text: "x", provider: "groq" }; },
    };
    const u: any = { id: 777, profile: {} };
    await answerQuestion(u, { question: "What should I do about the weather in routing cache?" }, deps).catch(() => {});
    await answerQuestion(u, { question: "what should I do about the  weather in routing cache?" }, deps).catch(() => {});
    assert.equal(routerCalls, 1);
  });
  console.log(`${n} connector/cache checks passed`);
})();
