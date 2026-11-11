import { NonceBridge } from "@/components/NonceBridge";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque"; // display / headings (OFL)
// fonts are bundled with the app, so builds never need Google Fonts
import "@fontsource-variable/newsreader"; // editorial headings (used selectively via font-serif)
import "@fontsource-variable/jetbrains-mono"; // technical metadata, ids, timestamps (font-mono)
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { themeBootScript } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: { default: "Jyntra — AI career intelligence", template: "%s · Jyntra" },
  description: "Jyntra finds current startup jobs, shows why each one fits your profile and where the listing came from, drafts outreach you review before it is sent, and tracks the result.",
  applicationName: "Jyntra",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the phone tab bar sit above the home indicator (safe-area padding)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c1f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce minted by middleware.ts. Reading it makes pages render per request (required for nonce-based CSP).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the theme script may add class="dark" before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <NonceBridge nonce={nonce} />
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <TooltipProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
          >
            Skip to content
          </a>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
