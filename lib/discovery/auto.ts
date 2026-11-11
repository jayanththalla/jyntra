// Automatic refresh of jobs and startups: called whenever a signed-in user opens or polls the app.
// A run starts only if the newest finished run is older than settings.live.discoveryStaleMinutes and the last
// attempt did not just fail. Overlapping runs are prevented by the in-process flag and the database lock.
import { query } from "@/lib/database";
import { runStatus, startDiscovery } from "@/lib/discovery/run";
import { settings } from "@/config/settings";

export async function maybeAutoRefreshDiscovery(): Promise<boolean> {
  if (runStatus().running) return false;
  const [last] = await query<{ started_at: Date; status: string }>("SELECT started_at, status FROM discovery_runs ORDER BY id DESC LIMIT 1");
  const [done] = await query<{ started_at: Date }>("SELECT started_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1");
  const age = done ? Date.now() - new Date(done.started_at).getTime() : Infinity;
  const recentFailure = !!last && last.status === "failed" && Date.now() - new Date(last.started_at).getTime() < settings.live.retryAfterFailureMinutes * 60_000;
  if (age <= settings.live.discoveryStaleMinutes * 60_000 || recentFailure) return false;
  return startDiscovery();
}
