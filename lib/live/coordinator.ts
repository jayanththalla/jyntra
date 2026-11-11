// Runs the heartbeat for every open tab of the app, with exactly ONE tab polling.
//
//  - Leader election uses the Web Locks API: the visible tab that holds the lock polls /api/live and broadcasts each snapshot
//    over a BroadcastChannel; other tabs only listen. When the leader tab hides or closes the lock passes to a visible tab.
//  - Without those APIs (old browsers, tests) every tab polls on its own, with jitter.
//  - A failed poll backs off (state.ts) and never starts a tight loop. After a reconnect the check is debounced.
// All environment access is injected so the multi-tab behaviour is testable without a browser.
import { applyBrowser, applyPoll, initialState, nextPollDelayMs, shouldReload, type LiveReply, type LiveState, type PollResult } from "./state";

export interface LocksLike {
  request(name: string, cb: () => Promise<void>): Promise<void>;
}
export interface ChannelLike {
  postMessage(msg: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}
export interface Env {
  fetchLive(): Promise<PollResult>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  visible(): boolean;
  browserOnline(): boolean;
  random(): number;
  locks?: LocksLike | null;
  openChannel?: (() => ChannelLike) | null;
}

type Msg = { t: "state"; state: LiveState } | { t: "wake" };

export const RECONNECT_DEBOUNCE_MS = 1_500;
/** A follower that becomes visible asks the leader to refresh, but never more often than this. */
export const WAKE_MIN_GAP_MS = 10_000;

export class LiveCoordinator {
  state: LiveState;
  private timer: unknown = null;
  private debounce: unknown = null;
  private inflight = false;
  private leader = false;
  private releaseLock: (() => void) | null = null;
  private lastPollAt = 0;
  private channel: ChannelLike | null = null;
  private stateListeners = new Set<(s: LiveState) => void>();
  private reloadListeners = new Set<() => void>();
  private started = false;
  /** set while the browser was offline; the next successful check reloads page data once */
  private wasOffline = false;
  /** how many polls THIS instance made (tests assert that followers make none) */
  polls = 0;

  constructor(private env: Env) {
    this.state = initialState(env.browserOnline());
  }

  subscribe(onState: (s: LiveState) => void, onReload?: () => void): () => void {
    this.stateListeners.add(onState);
    if (onReload) this.reloadListeners.add(onReload);
    if (!this.started) this.start();
    onState(this.state);
    return () => {
      this.stateListeners.delete(onState);
      if (onReload) this.reloadListeners.delete(onReload);
      if (!this.stateListeners.size) this.stop();
    };
  }

  isLeader() {
    return this.leader;
  }

  // ---- lifecycle ----
  private start() {
    this.started = true;
    this.state = { ...this.state, browserOnline: this.env.browserOnline() };
    this.channel = this.env.openChannel?.() ?? null;
    if (this.channel) {
      this.channel.onmessage = (ev) => this.onMessage(ev.data as Msg);
    }
    this.updateLeadership();
  }

  private stop() {
    this.started = false;
    this.clearTimers();
    this.releaseLeadership();
    this.channel?.close();
    this.channel = null;
  }

  private clearTimers() {
    if (this.timer) this.env.clearTimeout(this.timer);
    if (this.debounce) this.env.clearTimeout(this.debounce);
    this.timer = this.debounce = null;
  }

  // ---- browser events (wired by the hook) ----
  onVisibilityChange() {
    if (!this.started) return;
    if (this.env.visible()) {
      this.updateLeadership();
      if (this.leader) this.pollSoon(0);
      else if (this.env.now() - this.lastPollAt > WAKE_MIN_GAP_MS) this.channel?.postMessage({ t: "wake" } satisfies Msg);
    } else {
      this.releaseLeadership();
      this.clearTimers();
    }
  }

  onBrowserOnline() {
    if (!this.started) return;
    this.setState(applyBrowser(this.state, true));
    // Debounced: flapping connections (online/offline/online within a second) produce ONE check, not several.
    if (this.debounce) this.env.clearTimeout(this.debounce);
    this.debounce = this.env.setTimeout(() => {
      this.debounce = null;
      if (this.leader) void this.poll();
      else this.channel?.postMessage({ t: "wake" } satisfies Msg);
    }, RECONNECT_DEBOUNCE_MS);
  }

  onBrowserOffline() {
    if (!this.started) return;
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    this.wasOffline = true;
    this.setState(applyBrowser(this.state, false));
    this.broadcast();
  }

  // ---- leadership ----
  private updateLeadership() {
    if (this.leader || !this.env.visible()) {
      if (!this.leader) return;
    }
    if (this.leader) return;
    const locks = this.env.locks;
    if (!locks) {
      this.becomeLeader(); // no coordination available: this tab polls on its own
      return;
    }
    // The callback runs when this tab is granted the lock; the lock is held until the promise settles.
    void locks.request("jyntra-live-heartbeat", () => {
      if (!this.started || !this.env.visible()) return Promise.resolve(); // hidden/closed while waiting: give it straight back
      return new Promise<void>((resolve) => {
        this.releaseLock = resolve;
        this.becomeLeader();
      });
    });
  }

  private becomeLeader() {
    this.leader = true;
    this.pollSoon(this.state.ready ? 0 : 0);
  }

  private releaseLeadership() {
    this.leader = false;
    const r = this.releaseLock;
    this.releaseLock = null;
    r?.();
  }

  // ---- polling (leader only) ----
  private pollSoon(ms: number) {
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = this.env.setTimeout(() => void this.poll(), ms);
  }

  private schedule() {
    if (this.timer) this.env.clearTimeout(this.timer);
    this.timer = null;
    if (!this.leader) return;
    const d = nextPollDelayMs(this.state, this.env.now(), this.env.visible());
    if (d === null) return;
    const jitter = this.env.locks ? 0 : Math.round(this.env.random() * 2_000); // uncoordinated tabs spread out
    this.timer = this.env.setTimeout(() => void this.poll(), d + jitter);
  }

  async poll() {
    if (this.inflight || !this.leader) return;
    if (!this.env.browserOnline()) {
      this.wasOffline = true;
      this.setState(applyBrowser(this.state, false));
      this.broadcast();
      return; // nothing to check; the online event resumes polling
    }
    this.inflight = true;
    this.polls++;
    this.lastPollAt = this.env.now();
    let result: PollResult;
    try {
      result = await this.env.fetchLive();
    } catch {
      result = { kind: "network" };
    }
    this.inflight = false;
    if (!this.started) return;
    this.apply(applyPoll(this.state, result, this.env.now(), this.env.browserOnline()));
    this.broadcast();
    this.schedule();
  }

  // ---- state fan-out ----
  private apply(next: LiveState) {
    let reload = shouldReload(this.state, next);
    if (this.wasOffline && next.api === "ok" && next.browserOnline) {
      reload = true;
      this.wasOffline = false;
    }
    this.setState(next);
    if (reload) this.reloadListeners.forEach((fn) => fn());
  }

  private setState(next: LiveState) {
    this.state = next;
    this.stateListeners.forEach((fn) => fn(next));
  }

  private broadcast() {
    this.channel?.postMessage({ t: "state", state: this.state } satisfies Msg);
  }

  private onMessage(m: Msg) {
    if (m.t === "wake") {
      if (this.leader && this.env.now() - this.lastPollAt > WAKE_MIN_GAP_MS) this.pollSoon(0);
      return;
    }
    if (this.leader) return; // the leader is the source of truth
    // A follower adopts the leader's snapshot but keeps its OWN view of the browser connection.
    this.apply({ ...m.state, browserOnline: this.env.browserOnline() });
  }
}

export type { LiveReply };
