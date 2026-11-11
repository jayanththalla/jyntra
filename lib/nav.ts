// One list of destinations shared by the sidebar, the mobile drawer, the breadcrumb and the command palette,
// so a route can never appear in one and be missing from another.
// Companies and Hyderabad Jobs stay out on purpose: they are hidden from primary navigation (the pages still exist).
import type { IconComponent } from "@/components/icons";
import { MicIcon, ClipboardListIcon } from "@/components/icons";
import { HomeNavIcon, DiscoverNavIcon, AtlasNavIcon, InterviewNavIcon, OpenSourceNavIcon, NewsNavIcon, ProfileNavIcon } from "@/components/icons-nav";

export type NavItem = { href: string; label: string; hint: string; icon: IconComponent; keywords?: string[] };

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", hint: "Your career overview", icon: HomeNavIcon, keywords: ["home", "overview"] },
  { href: "/discover", label: "Discover", hint: "Startups and jobs matched to you", icon: DiscoverNavIcon, keywords: ["jobs", "startups", "search"] },
  { href: "/career-ai", label: "Atlas", hint: "Ask questions answered from your own documents", icon: AtlasNavIcon, keywords: ["ai", "chat", "rag", "knowledge"] },
  { href: "/applications", label: "Applications", hint: "Track where you applied", icon: ClipboardListIcon, keywords: ["tracker", "applied"] },
  { href: "/mock-interview", label: "AI Interview", hint: "Practise and get an assessment", icon: InterviewNavIcon, keywords: ["mock", "practice", "interview"] },
  { href: "/open-source", label: "Open Source", hint: "Find beginner-friendly issues", icon: OpenSourceNavIcon, keywords: ["github", "issues", "contribute"] },
  { href: "/news", label: "Funding News", hint: "Who raised what, with sources", icon: NewsNavIcon, keywords: ["funding", "investors", "rounds"] },
];

/** Secondary destinations: reachable from the palette and breadcrumbs, not from the primary navigation. */
export const EXTRA: NavItem[] = [
  { href: "/settings", label: "Profile & settings", hint: "Your profile, integrations and account", icon: ProfileNavIcon, keywords: ["profile", "account", "gmail", "github"] },  // reached from the account menu (top-right avatar), not the sidebar
  { href: "/mock-interview/history", label: "Interview history", hint: "Past sessions and reports", icon: MicIcon, keywords: ["reports", "past"] },
];

const LABELS: Record<string, string> = {
  contribute: "Contribute", history: "History", formal: "Formal interview", voice: "Voice interview", import: "Import",
  startups: "Startup", outreach: "Outreach", applications: "Applications", companies: "Companies", hyderabad: "Hyderabad jobs",
  admin: "Admin", sources: "Sources", tools: "Tools", "career-ai": "Atlas", reminders: "Reminders", tracker: "Tracker", workflows: "Workflows", email: "Email",
};

/** Breadcrumb trail for a pathname: [{label, href}], the last one is the current page. */
export function crumbs(path: string): { label: string; href: string }[] {
  const parts = path.split("/").filter(Boolean);
  const out: { label: string; href: string }[] = [];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    const nav = [...NAV, ...EXTRA].find((n) => n.href === acc);
    out.push({ href: acc, label: nav?.label ?? LABELS[p] ?? (/^\d+$/.test(p) ? `#${p}` : p.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())) });
  }
  return out;
}
