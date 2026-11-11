"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, LightbulbIcon } from "@/components/icons";
import { useToast } from "@/components/kit/Toast";
import { downloadText } from "@/lib/client-download";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const firstSentence = (t?: string | null) => (t ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 220) ?? "";

/**
 * "Proof of work beats a cold DM": a short, honest nudge plus a brief the candidate fills in.
 * Everything shown comes from the company's own record (name, description, open roles); nothing is invented.
 */
export function ProofOfWork({ name, description, roles, website }: { name: string; description: string | null; roles: string[]; website: string | null }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const does = firstSentence(description);
  const brief = [
    `Proof-of-work brief: ${name}`,
    "",
    `What they do: ${does || "(read their site and write it in one sentence)"}`,
    roles.length ? `Roles they are hiring for: ${roles.join(", ")}` : "",
    "",
    "1. The problem I think they are working on: ______",
    "2. The small part I will solve or build (1-2 days of work): ______",
    "3. What I made (link, demo or short video): ______",
    "4. What I would do next if I joined: ______",
    "",
    "Message to the team (2-3 lines, lead with the link):",
    `"Hi, I built <what you made> for the <problem> at ${name}. Here it is: <link>. Happy to walk through how I did it."`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  async function copy() {
    try { await navigator.clipboard.writeText(brief); setCopied(true); toast("Brief copied"); setTimeout(() => setCopied(false), 2000); } catch { toast("Couldn't copy. Open 'See the brief' and select the text.", "error"); }
  }

  return (
    <Card>
      <CardHeader className="sm:px-6">
        <CardTitle className="flex items-center gap-2 text-xl"><LightbulbIcon className="size-5 text-accent-brand" />Show your work, don&apos;t just DM</CardTitle>
        <CardDescription>A cold message that lists what you have done is easy to ignore. Something you made for their problem is not.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 sm:px-6">
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["Find the problem", does ? `${name}: ${does}` : `Read what ${name} says it does${website ? " on its website" : ""} and the roles it is hiring for.`],
            ["Build a small part", roles.length ? `Tie it to a role you want (${roles.slice(0, 2).join(", ")}). Keep it to a day or two.` : "Keep it to a day or two: a prototype, analysis, teardown or fix."],
            ["Share it directly", "Send the link to the team, not a résumé. Lead with what you made and what you learned."],
          ].map(([t, d], i) => (
            <li key={t} className="tile p-4">
              <span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-bold text-accent-brand-foreground">{i + 1}</span>
              <p className="mt-2 font-semibold">{t}</p>
              <p className="mt-1 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">See the brief</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{brief}</pre>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? "Copied" : "Copy the brief"}</Button>
          <Button variant="ghost" onClick={() => { downloadText(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-proof-of-work.txt`, brief); toast("Brief downloaded"); }}><DownloadIcon />Download</Button>
        </div>
      </CardContent>
    </Card>
  );
}
