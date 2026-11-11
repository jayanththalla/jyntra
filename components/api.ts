// Client-side fetch + JSON that never throws. A server error page, a dropped connection or a
// non-JSON body all come back as { ok: false }, so the UI can show a message instead of hanging.

export interface ApiResult<T = any> {
  ok: boolean;
  status: number; // 0 = network error (offline, server down)
  data: T;
  error: string | null; // friendly message when !ok
}

/** A hung request becomes a normal failure after this long, so no screen loads forever. */
export const API_TIMEOUT_MS = 30_000;

export async function api<T = any>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<ApiResult<T>> {
  const { timeoutMs = API_TIMEOUT_MS, ...rest } = init ?? {};
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const outer = rest.signal;
  if (outer) outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  let res: Response;
  let data: any;
  try {
    res = await fetch(url, { cache: "no-store", ...rest, signal: ctrl.signal });
    data = await res.json().catch(() => ({}));
  } catch {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      data: {} as T,
      error: timedOut ? "This is taking longer than expected. Try again." : "Can't reach the server. Check your connection and try again.",
    };
  }
  clearTimeout(timer);
  if (res.ok) return { ok: true, status: res.status, data, error: null };
  const msg = typeof data?.error === "string" && data.error !== "no_profile" ? data.error : null;
  return { ok: false, status: res.status, data, error: msg ?? "Something went wrong on our side. Please try again in a moment." };
}

export const jsonBody = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
