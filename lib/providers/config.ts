// Operator switches for optional or unreliable providers. Read from the environment on every call (not at import), so a
// switch changes behaviour after a restart without a rebuild and tests can pass their own env.
type Env = Record<string, string | undefined>;

const off = (v: string | undefined) => /^(0|false|off|no|disabled)$/i.test((v ?? "").trim());
const on = (v: string | undefined) => /^(1|true|on|yes|enabled)$/i.test((v ?? "").trim());

/** Himalayas remote jobs. ON by default; set HIMALAYAS_ENABLED=false to switch it off without affecting any other feed. */
export function himalayasEnabled(env: Env = process.env): boolean {
  return !off(env.HIMALAYAS_ENABLED);
}

/**
 * GDELT DOC API (secondary article discovery). OFF by default: it is an unauthenticated third-party service limited to one
 * request per 5 seconds, and its article metadata is unverified until reviewed. Set GDELT_ENABLED=true to turn it on.
 */
export function gdeltEnabled(env: Env = process.env): boolean {
  return on(env.GDELT_ENABLED);
}

/** BLR Startup Arena job lists. OFF by default; set BLRARENA_ENABLED=true. */
export function blrArenaEnabled(env: Env = process.env): boolean {
  return on(env.BLRARENA_ENABLED);
}

/** Why a provider is switched off by configuration, or null when it is active. Used by source health and the diagnostics view. */
export function disabledByConfig(sourceId: string, env: Env = process.env): string | null {
  if (sourceId === "himalayas" && !himalayasEnabled(env)) return "Turned off by HIMALAYAS_ENABLED";
  if (sourceId === "blrarena" && !blrArenaEnabled(env)) return "Off by default; set BLRARENA_ENABLED=true to use it";
  if (sourceId === "gdelt" && !gdeltEnabled(env)) return "Off by default; set GDELT_ENABLED=true to use it";
  return null;
}
