"use client";
import { Skeleton } from "@/components/Skeleton";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/components/api";
import type { Summary } from "./types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Banner } from "@/components/Banner";
import { SparklesIcon } from "@/components/icons";

/** Compact Career AI status. Shows only numbers the API returned; a failed source is called out, never shown as healthy. */
export function KnowledgeWidget() {
  const [s, setS] = useState<Summary | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    api<Summary>("/api/kb/summary").then((r) => {
      if (!live) return;
      if (r.ok) { setS(r.data); setState("ok"); } else setState("error");
    });
    return () => { live = false; };
  }, []);
  const empty = s && s.totals.documents === 0;
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><SparklesIcon className="size-4 text-accent-brand-foreground" /> Atlas</CardTitle>
        <CardDescription>Your knowledge base, built from your own sources.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === "loading" && <Skeleton variant="list" count={2} />}
        {state === "error" && <Banner tone="warn">Couldn&apos;t load your knowledge base status right now.</Banner>}
        {s && (
          <>
            {s.unhealthy.length > 0 && <Banner tone="warn">{s.unhealthy.map((u) => u.label).join(", ")}: last sync failed.</Banner>}
            {empty ? (
              <p className="text-muted-foreground">Nothing indexed yet. Connect GitHub or upload a resume to get answers grounded in your work.</p>
            ) : (
              <>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {([["Sources", s.totals.sources], ["Documents", s.totals.documents], ["Projects", s.totals.projects]] as const).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-muted/40 p-2"><dd className="text-lg font-semibold">{v}</dd><dt className="text-xs text-muted-foreground">{k}</dt></div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">Last successful sync: {s.last_successful_sync ? new Date(s.last_successful_sync).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "none yet"}</p>
                {s.recommended_actions[0] && <p className="text-xs">Next: {s.recommended_actions[0]}</p>}
              </>
            )}
            <Link href="/career-ai" className={buttonVariants({ variant: "outline", size: "sm" })}>Open Atlas</Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
