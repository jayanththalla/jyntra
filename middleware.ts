// 1) Optional site-wide password (HTTP Basic Auth) — only when APP_PASSWORD is set.
//    Leave it unset for a public deployment that anyone can use.
// 2) Visitors without a session cookie are sent to /login (Google sign-in, or continue without an account) before seeing app pages.
// 3) Content-Security-Policy with a per-request nonce (see lib/csp.ts and docs/SECURITY.md).
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, cspMode, newNonce } from "@/lib/csp";

const APP_PAGES = ["/dashboard", "/discover", "/tools", "/yc-jobs", "/open-source", "/jobs", "/applications", "/settings", "/startups", "/news", "/outreach", "/career-ai", "/mock-interview", "/hyderabad", "/companies", "/admin"];

/** Compares without exiting early on the first differing character (no timing oracle for the site password). */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (password) {
    const user = process.env.APP_USER || "admin";
    const header = req.headers.get("authorization") ?? "";
    let ok = false;
    if (header.startsWith("Basic ")) {
      try {
        const [u, ...rest] = atob(header.slice(6)).split(":");
        ok = sameSecret(u, user) && sameSecret(rest.join(":"), password); // both evaluated: no short-circuit
      } catch {}
    }
    if (!ok) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Jyntra", charset="UTF-8"' },
      });
    }
  }

  const path = req.nextUrl.pathname;
  if (APP_PAGES.some((p) => path === p || path.startsWith(p + "/")) && !req.cookies.get("sf_uid")?.value) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, req.url));
  }

  const mode = cspMode();
  if (mode === "off") return NextResponse.next();
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production", report: mode === "report-only" });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce); // read by app/layout.tsx for the inline theme script
  headers.set(cspHeaderName(mode), csp); // Next.js reads the nonce from this request header to stamp its own scripts
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(cspHeaderName(mode), csp);
  return res;
}

export const config = {
  matcher: [
    // Pages and APIs; skip static assets and health. Prefetches don't need a nonce.
    { source: "/((?!_next/static|_next/image|favicon.ico|api/health).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
  ],
};
