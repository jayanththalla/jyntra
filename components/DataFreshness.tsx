"use client";
import { useEffect } from "react";
import { api } from "./api";
import { useLive } from "./live";
import { connectionBanner } from "@/lib/live/state";

export { ago } from "@/lib/live/state";

const SYNC_KEY = "jyntra.autosync.v1";
const SYNC_EVERY_MS = 20 * 60_000; // at most one automatic sync per browser every 20 minutes

/**
 * Starts the background sync by itself when someone opens a page, so nobody has to find a "refresh" button.
 * Fails silently (no profile yet, offline, rate-limited): the data on screen stays valid either way.
 */
function useAutoSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    try {
      const last = Number(sessionStorage.getItem(SYNC_KEY) ?? localStorage.getItem(SYNC_KEY) ?? 0);
      if (Date.now() - last < SYNC_EVERY_MS) return;
      localStorage.setItem(SYNC_KEY, String(Date.now()));
      sessionStorage.setItem(SYNC_KEY, String(Date.now()));
    } catch {}
    api("/api/discover", { method: "POST" }).catch(() => {});
  }, [enabled]);
}

/**
 * Connection notices only: offline, or reconnecting. Nothing is rendered when everything is fine, so it never reserves
 * empty space. Background updates are shown as a light shimmer on the content itself (see RefreshShimmer), not as a message.
 */
export function DataFreshness() {
  const live = useLive();
  useAutoSync(live.ready && live.api === "ok");
  const banner = connectionBanner(live);

  let text: string | null = null;
  if (live.ready && !live.browserOnline) text = "You\u2019re offline. Your results will refresh when you\u2019re back online.";
  else if (live.ready && (banner.kind === "api_unreachable" || banner.kind === "api_busy")) text = "Reconnecting\u2026 your results will refresh in a moment.";
  if (!text) return null;
  return <p role="status" aria-live="polite" className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">{text}</p>;
}

/** True while the background sync is refreshing. Pages feed this into <RefreshShimmer>. */
export function useBackgroundRefresh() {
  return useLive().refresh === "refreshing";
}
