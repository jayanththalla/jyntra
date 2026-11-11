"use client";
// Shared heartbeat for the whole app. The logic lives in lib/live (pure state + a coordinator that makes ONE open tab poll
// /api/live and share the result with the others). This file only connects it to the browser and React.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LiveCoordinator, type Env } from "@/lib/live/coordinator";
import type { LiveReply, LiveState, PollResult } from "@/lib/live/state";

export type { LiveState };

async function fetchLive(): Promise<PollResult> {
  const r = await api<LiveReply>("/api/live", { timeoutMs: 10_000 });
  if (r.ok) return { kind: "ok", reply: r.data };
  if (r.status === 0) return { kind: "network" };
  const ra = Number((r.data as { retryAfterSeconds?: number })?.retryAfterSeconds);
  return { kind: "http", status: r.status, retryAfterSeconds: Number.isFinite(ra) ? ra : undefined };
}

let coordinator: LiveCoordinator | null = null;
function get(): LiveCoordinator {
  if (coordinator) return coordinator;
  const env: Env = {
    fetchLive,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    visible: () => document.visibilityState === "visible",
    browserOnline: () => navigator.onLine,
    random: Math.random,
    locks: typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as Env["locks"]) : null,
    openChannel: typeof BroadcastChannel !== "undefined" ? () => new BroadcastChannel("jyntra-live") as unknown as ReturnType<NonNullable<Env["openChannel"]>> : null,
  };
  coordinator = new LiveCoordinator(env);
  const c = coordinator;
  document.addEventListener("visibilitychange", () => c.onVisibilityChange());
  window.addEventListener("online", () => c.onBrowserOnline());
  window.addEventListener("offline", () => c.onBrowserOffline());
  return c;
}

/** Subscribes to the shared heartbeat. `onChange` runs when a refresh finished or the app recovered from a failure. */
export function useLive(onChange?: () => void): LiveState {
  const [s, setS] = useState<LiveState>(() => (typeof window === "undefined" ? ({ ready: false } as LiveState) : get().state));
  const cb = useRef(onChange);
  cb.current = onChange; // latest callback without resubscribing
  useEffect(() => get().subscribe(setS, () => cb.current?.()), []);
  return s;
}
