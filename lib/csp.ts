// Content-Security-Policy, built per request so inline scripts can be authorised with a nonce instead of 'unsafe-inline'.
// Edge-safe (used by middleware.ts): no Node APIs.
//
// The app is self-contained: fonts are bundled (@fontsource), there are no third-party scripts, no remote images and the
// browser only calls its own /api routes. So almost everything is 'self'. Server-side calls (Groq, Gemini, Google, GitHub...)
// are not subject to CSP and are deliberately NOT listed.
//
// CSP_MODE: "enforce" (default) | "report-only" (log violations to /api/csp-report, block nothing) | "off".

export type CspMode = "enforce" | "report-only" | "off";

export const cspMode = (env: Record<string, string | undefined> = process.env): CspMode => {
  const m = (env.CSP_MODE ?? "").toLowerCase();
  return m === "report-only" || m === "off" ? m : "enforce";
};

export const newNonce = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
};

export function buildCsp(nonce: string, opts: { dev?: boolean; report?: boolean } = {}): string {
  const dev = !!opts.dev;
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets nonce-trusted Next bootstrap scripts load their chunks; 'self' is ignored by browsers that honour it.
    // React's dev tooling needs eval(); production does not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    // Radix/React set style="" attributes at runtime. Attributes only: <style> elements still need the nonce.
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    // Interviewer speech is fetched from our own API and played from a blob: URL.
    "media-src": ["'self'", "blob:"],
    "connect-src": ["'self'", "https://api.openai.com", ...(dev ? ["ws:", "http://localhost:*"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  if (opts.report) parts.push("report-uri /api/csp-report");
  return parts.join("; ");
}

export const cspHeaderName = (mode: CspMode) => (mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy");
