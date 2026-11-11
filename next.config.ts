import type { NextConfig } from "next";
import path from "node:path";

// Baseline response headers. The Content-Security-Policy is NOT here: it needs a per-request nonce, so middleware.ts
// sets it (lib/csp.ts). Keeping it in one place avoids duplicate/conflicting CSP headers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Old entry points keep working: they land on the one Discover screen with the equivalent filter applied.
  async redirects() {
    return [
      { source: "/jobs", destination: "/discover", permanent: false },
      { source: "/yc-jobs", destination: "/discover?source=yc", permanent: false },
      { source: "/startups", destination: "/discover?tab=startups", permanent: false },

      { source: "/tools", destination: "/career-ai", permanent: false },
      { source: "/career-ai/tracker", destination: "/dashboard", permanent: false },
      { source: "/career-ai/reminders", destination: "/dashboard", permanent: false },
      { source: "/career-ai/applications", destination: "/dashboard", permanent: false },
    ];
  },
  serverExternalPackages: ["pg", "pdfkit", "sql.js"],
  // Serverless/standalone tracing cannot see files that are loaded by path at run time: the SQL sandbox worker loads sql.js's WASM, and PDF export reads pdfkit's font metrics.
  outputFileTracingIncludes: {
    "/api/interview/**": ["./node_modules/sql.js/dist/**", "./node_modules/pdfkit/js/data/**"],
  },
  // There's another package-lock.json higher up in the home folder; pin the project root.
  outputFileTracingRoot: path.join(__dirname),
  webpack: (config) => {
    // The local database (.pgdata), HTTP cache and exports change constantly at runtime;
    // watching them made the dev server recompile in a loop.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/.pgdata/**", "**/.cache/**", "**/exports/**"],
    };
    return config;
  },
};

export default nextConfig;
