import { settings } from "@/config/settings";
type Env = Record<string, string | undefined>;
/** FUNDING_NEWS_REFRESH_ENABLED (default true) and FUNDING_NEWS_REFRESH_INTERVAL_MINUTES (default: settings, min 5, max 1440). */
export function newsRefreshSettings(env: Env = process.env): { enabled: boolean; intervalMinutes: number } {
  const enabled = (env.FUNDING_NEWS_REFRESH_ENABLED ?? "true").trim().toLowerCase() !== "false";
  const n = Number(env.FUNDING_NEWS_REFRESH_INTERVAL_MINUTES);
  return { enabled, intervalMinutes: Number.isFinite(n) && n > 0 ? Math.min(1440, Math.max(5, Math.round(n))) : settings.live.newsStaleMinutes };
}
