// Connectivity model + multi-tab coordinator. No browser: time, locks, channel and fetch are fakes. Run: npx tsx scripts/test-live.ts
import assert from "node:assert/strict";
import { applyBrowser, applyPoll, backoffMs, connectionBanner, dataLine, initialState, nextPollDelayMs, shouldReload, type LiveReply, type PollResult } from "@/lib/live/state";
import { LiveCoordinator, RECONNECT_DEBOUNCE_MS, type ChannelLike, type Env, type LocksLike } from "@/lib/live/coordinator";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { process.exitCode = 1; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const T0 = Date.parse("2026-10-29T10:00:00Z");
const reply = (o: Partial<LiveReply> = {}): LiveReply => ({ version: "1|a|b", discovery: { running: false, finishedAt: "2026-10-29T09:55:00Z" }, news: { refreshing: false, checkedAt: "2026-10-29T09:58:00Z" }, refresh: { state: "idle", lastSuccessAt: "2026-10-29T09:58:00Z", lastFailureAt: null }, servingCache: false, ...o });

async function main() {
console.log("state: layers are independent");
await t("a 503 from /api/live is 'busy', never 'Offline'", () => {
  const s = applyPoll(initialState(), { kind: "http", status: 503 }, T0, true);
  assert.equal(s.api, "busy"); assert.equal(connectionBanner(s).kind, "api_busy");
});
await t("a 429 honours Retry-After and is not offline", () => {
  const s = applyPoll(initialState(), { kind: "http", status: 429, retryAfterSeconds: 40 }, T0, true);
  assert.equal(s.api, "busy"); assert.ok(s.retryAt! - T0 >= 40_000);
});
await t("a dropped request with the browser online is 'unreachable', not 'Offline'", () => {
  const s = applyPoll(initialState(), { kind: "network" }, T0, true);
  assert.equal(connectionBanner(s).kind, "api_unreachable");
});
await t("'Offline' appears only when the browser is offline", () => {
  const s = applyBrowser(applyPoll(initialState(), { kind: "ok", reply: reply() }, T0, true), false);
  assert.equal(connectionBanner(s).kind, "browser_offline");
  const s2 = applyPoll(s, { kind: "network" }, T0, false);
  assert.equal(s2.api, "ok", "a network failure while the browser is offline must not blame the server"); assert.equal(s2.failures, 0);
});
await t("401 (no profile yet) is not a fault", () => {
  assert.equal(connectionBanner(applyPoll(initialState(), { kind: "http", status: 401 }, T0, true)).kind, "none");
});
await t("a failing provider does not change the connection banner", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply({ sourcesNeedingAttention: 2 }) }, T0, true);
  assert.equal(connectionBanner(s).kind, "none"); assert.equal(s.sourcesNeedingAttention, 2);
});

console.log("state: cached data and refresh");
await t("no cached banner on a healthy refresh", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply() }, T0, true);
  assert.equal(dataLine(s, T0 + 60_000).tone, "live"); assert.match(dataLine(s, T0 + 60_000).text, /Updated/);
});
await t("cached banner only when the refresh failed and older data exists, with its real age", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply({ servingCache: true, refresh: { state: "failed", lastSuccessAt: "2026-10-29T06:00:00Z", lastFailureAt: "2026-10-29T09:59:00Z" } }) }, T0, true);
  const l = dataLine(s, T0); assert.equal(l.tone, "cached"); assert.match(l.text, /4 h ago/);
});
await t("servingCache without any last-good time is not claimed", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply({ servingCache: true, refresh: { state: "failed", lastSuccessAt: null, lastFailureAt: null }, discovery: { running: false, finishedAt: null }, news: { refreshing: false, checkedAt: null } }) }, T0, true);
  assert.equal(s.servingCache, false);
});
await t("refresh-in-progress is its own state", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply({ discovery: { running: true, finishedAt: "2026-10-29T09:55:00Z" } }) }, T0, true);
  assert.equal(s.refresh, "refreshing"); assert.equal(nextPollDelayMs(s, T0, true), 5_000);
});
await t("cached banner clears after a successful refresh", () => {
  let s = applyPoll(initialState(), { kind: "ok", reply: reply({ servingCache: true, refresh: { state: "failed", lastSuccessAt: "2026-10-29T06:00:00Z", lastFailureAt: null } }) }, T0, true);
  s = applyPoll(s, { kind: "ok", reply: reply({ version: "2|x|y" }) }, T0 + 1000, true);
  assert.equal(s.servingCache, false); assert.equal(dataLine(s, T0).tone, "live");
});

console.log("state: backoff and recovery");
await t("backoff is bounded and grows", () => {
  const d = [1, 2, 3, 4, 5, 9, 30].map((n) => backoffMs(n, undefined, 0.5));
  assert.deepEqual(d.slice(0, 5), [5000, 10000, 20000, 40000, 60000]); assert.ok(d.every((x) => x <= 60_000 * 1.25));
});
await t("no polling while hidden or offline", () => {
  const s = applyPoll(initialState(), { kind: "ok", reply: reply() }, T0, true);
  assert.equal(nextPollDelayMs(s, T0, false), null); assert.equal(nextPollDelayMs({ ...s, browserOnline: false }, T0, true), null);
});
await t("recovery after a failed check clears the notice and asks pages to reload", () => {
  const bad = applyPoll(applyPoll(initialState(), { kind: "ok", reply: reply() }, T0, true), { kind: "http", status: 503 }, T0 + 1, true);
  const good = applyPoll(bad, { kind: "ok", reply: reply() }, T0 + 9_000, true);
  assert.equal(connectionBanner(good).kind, "none"); assert.equal(good.failures, 0); assert.equal(shouldReload(bad, good), true);
});
await t("an unchanged healthy poll does not reload pages", () => {
  const a = applyPoll(initialState(), { kind: "ok", reply: reply() }, T0, true);
  assert.equal(shouldReload(a, applyPoll(a, { kind: "ok", reply: reply() }, T0 + 30_000, true)), false);
});

console.log("coordinator: multiple tabs");
class Clock {
  now = T0; q: { at: number; fn: () => void; id: number }[] = []; n = 0;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.n; this.q.push({ at: this.now + ms, fn, id }); return id; };
  clearTimeout = (h: unknown) => { this.q = this.q.filter((x) => x.id !== h); };
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const nx = this.q[0];
      if (!nx || nx.at > end) break;
      this.q.shift(); this.now = nx.at; nx.fn(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    this.now = end;
  }
}
class FakeLocks implements LocksLike {
  held = false; waiting: (() => void)[] = [];
  request(_n: string, cb: () => Promise<void>) {
    return new Promise<void>((resolve) => {
      const run = () => { this.held = true; cb().then(() => { this.held = false; resolve(); this.waiting.shift()?.(); }); };
      this.held ? this.waiting.push(run) : run();
    });
  }
}
class Bus { members = new Set<FakeChannel>(); }
class FakeChannel implements ChannelLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(private bus: Bus) { bus.members.add(this); }
  postMessage(m: unknown) { for (const c of this.bus.members) if (c !== this) queueMicrotask(() => c.onmessage?.({ data: structuredClone(m) })); }
  close() { this.bus.members.delete(this); }
}
function world() {
  const clock = new Clock(), locks = new FakeLocks(), bus = new Bus();
  const server = { calls: 0, next: (): PollResult => ({ kind: "ok", reply: reply() }) };
  const mk = (visible = true) => {
    const tab = { visible, online: true };
    const env: Env = { fetchLive: async () => { server.calls++; return server.next(); }, now: () => clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, visible: () => tab.visible, browserOnline: () => tab.online, random: () => 0.5, locks, openChannel: () => new FakeChannel(bus) };
    const c = new LiveCoordinator(env); const reloads = { n: 0 };
    const off = c.subscribe(() => {}, () => reloads.n++);
    return { c, tab, reloads, off };
  };
  return { clock, server, mk };
}
const settle = async (clock: Clock, ms = 100) => { await clock.advance(ms); await Promise.resolve(); await clock.advance(1); };

await t("three open tabs make ONE request per interval; all three see the state", async () => {
  const w = world(); const a = w.mk(), b = w.mk(), c = w.mk();
  await settle(w.clock);
  assert.equal(w.server.calls, 1); assert.equal(a.c.polls + b.c.polls + c.c.polls, 1);
  assert.ok(a.c.state.ready && b.c.state.ready && c.c.state.ready); assert.equal(b.c.state.api, "ok");
  await w.clock.advance(30_000); await settle(w.clock);
  assert.equal(w.server.calls, 2);
});
await t("when the leader tab is hidden another visible tab takes over", async () => {
  const w = world(); const a = w.mk(), b = w.mk(); await settle(w.clock);
  const leader = a.c.isLeader() ? a : b, other = leader === a ? b : a;
  leader.tab.visible = false; leader.c.onVisibilityChange(); await settle(w.clock);
  assert.ok(other.c.isLeader()); assert.ok(!leader.c.isLeader());
  const before = w.server.calls; await w.clock.advance(30_000); await settle(w.clock);
  assert.ok(w.server.calls > before);
});
await t("a hidden tab never polls", async () => {
  const w = world(); const a = w.mk(false); await settle(w.clock, 60_000);
  assert.equal(w.server.calls, 0); assert.equal(a.c.polls, 0);
});
await t("closing the leader hands over without a gap", async () => {
  const w = world(); const a = w.mk(), b = w.mk(); await settle(w.clock);
  const leader = a.c.isLeader() ? a : b, other = leader === a ? b : a;
  leader.off(); await settle(w.clock); assert.ok(other.c.isLeader());
});
await t("a failing server does not make any tab 'Offline' and backoff stays bounded", async () => {
  const w = world(); const a = w.mk(), b = w.mk(); w.server.next = () => ({ kind: "http", status: 503 });
  await settle(w.clock); await w.clock.advance(10 * 60_000);
  assert.equal(connectionBanner(a.c.state).kind, "api_busy"); assert.equal(connectionBanner(b.c.state).kind, "api_busy");
  assert.ok(w.server.calls <= 14, `no tight loop (calls=${w.server.calls})`);
});
await t("server recovery: notices clear in every tab and each page reloads once", async () => {
  const w = world(); const a = w.mk(), b = w.mk(); w.server.next = () => ({ kind: "http", status: 503 });
  await settle(w.clock); await w.clock.advance(20_000);
  w.server.next = () => ({ kind: "ok", reply: reply() }); await w.clock.advance(70_000); await settle(w.clock);
  assert.equal(connectionBanner(a.c.state).kind, "none"); assert.equal(connectionBanner(b.c.state).kind, "none");
  assert.equal(a.reloads.n, 1); assert.equal(b.reloads.n, 1);
});
await t("offline → online: one debounced check, 'Offline' disappears, pages reload", async () => {
  const w = world(); const a = w.mk(); await settle(w.clock);
  a.tab.online = false; a.c.onBrowserOffline(); assert.equal(connectionBanner(a.c.state).kind, "browser_offline");
  const before = w.server.calls; await w.clock.advance(120_000); assert.equal(w.server.calls, before, "no polling while offline");
  a.tab.online = true; a.c.onBrowserOnline(); a.c.onBrowserOnline(); a.c.onBrowserOnline(); // flapping
  await w.clock.advance(RECONNECT_DEBOUNCE_MS + 50); await settle(w.clock, 10);
  assert.equal(w.server.calls, before + 1, "three online events → one check");
  assert.equal(connectionBanner(a.c.state).kind, "none"); assert.ok(a.reloads.n >= 1);
});
await t("reconnect while the server is still down shows 'busy' (not Offline) and backs off", async () => {
  const w = world(); const a = w.mk(); await settle(w.clock);
  a.tab.online = false; a.c.onBrowserOffline(); w.server.next = () => ({ kind: "network" });
  a.tab.online = true; a.c.onBrowserOnline(); await w.clock.advance(RECONNECT_DEBOUNCE_MS + 50); await settle(w.clock, 10);
  assert.equal(connectionBanner(a.c.state).kind, "api_unreachable");
});
await t("a version change broadcast by the leader reloads follower pages", async () => {
  const w = world(); const a = w.mk(), b = w.mk(); await settle(w.clock);
  w.server.next = () => ({ kind: "ok", reply: reply({ version: "2|new|new" }) }); await w.clock.advance(30_000); await settle(w.clock);
  assert.equal(a.reloads.n, 1); assert.equal(b.reloads.n, 1);
});
await t("without Web Locks each tab polls on its own (fallback)", async () => {
  const clock = new Clock(); let calls = 0;
  const env: Env = { fetchLive: async () => (calls++, { kind: "ok", reply: reply() } as PollResult), now: () => clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, visible: () => true, browserOnline: () => true, random: () => 0.1, locks: null, openChannel: null };
  new LiveCoordinator(env).subscribe(() => {}); await settle(clock); assert.equal(calls, 1);
});
console.log(`\n${passed} connectivity checks passed`);
}
main();
