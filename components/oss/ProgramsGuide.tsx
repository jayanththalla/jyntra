"use client";
// Guide to open-source programs and a first-contribution path. Static, hand-written guidance: it links to each program's OFFICIAL site
// and deliberately states no dates, stipends or deadlines (those change every cycle; the official site is the source of truth).
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ExternalLinkIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

interface Program { name: string; by: string; level: "Beginner" | "Intermediate" | "Advanced"; what: string; fit: string; start: string; url: string }

const PROGRAMS: Program[] = [
  { name: "GirlScript Summer of Code (GSSoC)", by: "GirlScript Foundation", level: "Beginner", what: "A multi-week contribution programme run mostly by Indian student volunteers. Contributors work on participating projects and earn points for merged pull requests.", fit: "First-time contributors, especially students in India. A good first step before GSoC.", start: "Register on the official site, then pick a participating project and read its contributing guide before opening a PR.", url: "https://gssoc.girlscript.tech" },
  { name: "Hacktoberfest", by: "DigitalOcean", level: "Beginner", what: "A month-long event in October that encourages pull requests to open-source projects.", fit: "Anyone who wants a low-pressure reason to make a first few contributions.", start: "Sign up on the official site. Only contribute to projects that welcome it and avoid low-effort PRs, which maintainers dislike.", url: "https://hacktoberfest.com" },
  { name: "Google Summer of Code (GSoC)", by: "Google", level: "Intermediate", what: "A mentored programme where contributors work on a larger project with an open-source organisation over several months.", fit: "Students and early-career developers who already have some contributions.", start: "Pick an organisation, contribute to it first, then submit a proposal during the application window on the official site.", url: "https://summerofcode.withgoogle.com" },
  { name: "Outreachy", by: "Software Freedom Conservancy", level: "Intermediate", what: "Paid, remote mentored internships in open source for people underrepresented in tech.", fit: "People who face systemic bias in tech and want a structured, mentored start.", start: "Check eligibility on the official site, then make an initial contribution during the application period.", url: "https://www.outreachy.org" },
  { name: "MLH Fellowship", by: "Major League Hacking", level: "Intermediate", what: "A remote programme where you build or contribute to projects with a cohort and mentors.", fit: "Developers who want structure, a cohort and a portfolio project.", start: "Review the tracks and apply on the official site.", url: "https://fellowship.mlh.io" },
  { name: "LFX Mentorship", by: "The Linux Foundation", level: "Advanced", what: "Mentored projects with Linux Foundation hosted communities such as cloud-native and security projects.", fit: "Developers comfortable with larger codebases and infrastructure topics.", start: "Browse open mentorship projects on the official site and follow each project's application steps.", url: "https://lfx.linuxfoundation.org/tools/mentorship" },
];

const STEPS: [string, string][] = [
  ["Pick one project you actually use", "Familiarity beats stars. You will understand the problem and can test your own change."],
  ["Read CONTRIBUTING.md and the code of conduct", "Follow the project's setup steps and PR format exactly. Many rejected PRs fail on this."],
  ["Run it locally before choosing an issue", "If you cannot build it, you cannot fix anything yet. Ask in the project's chat or discussions if you are stuck."],
  ["Claim a small issue and say so", "Comment that you would like to work on it and wait for a maintainer to confirm. Docs, tests and small bugs are valid first contributions."],
  ["Open a focused pull request", "One change, a clear description, linked to the issue. Respond to review comments politely and quickly."],
];

export function ProgramsGuide() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="space-y-4 p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span><span className="block text-sm font-semibold">Programmes and a first-contribution path</span><span className="block text-xs text-muted-foreground">GSSoC, GSoC, Hacktoberfest, Outreachy and more: what each is, who it suits, and how to start.</span></span>
        <span className="text-xs text-primary">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-5">
          <ol className="grid gap-2 md:grid-cols-5">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-lg border p-3 text-xs"><span className="mb-1 flex size-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{i + 1}</span><span className="block font-medium">{t}</span><span className="mt-1 block text-muted-foreground">{d}</span></li>
            ))}
          </ol>
          <ul className="grid gap-3 md:grid-cols-2">
            {PROGRAMS.map((p) => (
              <li key={p.name} className="space-y-2 rounded-lg border p-3 text-xs">
                <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{p.name}</span><Badge variant="secondary">{p.level}</Badge></div>
                <p className="text-muted-foreground">By {p.by}. {p.what}</p>
                <p><span className="font-medium">Good for:</span> {p.fit}</p>
                <p><span className="font-medium">How to start:</span> {p.start}</p>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Official site <ExternalLinkIcon /></a>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">Dates, eligibility and stipends change every cycle and are not shown here. Check the official site before you plan around any of them.</p>
        </div>
      )}
    </Card>
  );
}
