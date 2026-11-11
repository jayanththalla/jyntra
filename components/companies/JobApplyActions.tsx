"use client";
import { useState } from "react";
import { BookmarkIcon, ExternalLinkIcon, Loader2Icon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { api, jsonBody } from "@/components/api";
import type { ArenaJob } from "@/lib/arena/shared";

export function JobApplyActions({ job, slug, sourcePage = null, compact = false }: { job: ArenaJob; slug: string; sourcePage?: string | null; compact?: boolean }) {
  const url = job.applicationUrl || job.applyUrl;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await api("/api/companies/jobs/save", { method: "POST", ...jsonBody({ slug, jobId: job.id }) });
    setBusy(false);
    if (r.status === 401) {
      setErr("Sign in to save");
      return;
    }
    if (!r.ok) {
      setErr("Could not save");
      return;
    }
    setSaved(true);
  }

  return (
    <div className={`flex ${compact ? "flex-col items-end" : "flex-wrap items-center"} gap-1.5`}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ size: "sm", className: "shrink-0" })}>
          Apply now
          <ExternalLinkIcon />
          <span className="sr-only">for {job.title} (opens in a new tab)</span>
        </a>
      ) : (
        <p className="max-w-[11rem] text-right text-[11px] leading-snug text-muted-foreground">
          Application link unavailable
          {sourcePage && (
            <>
              {" · "}
              <a href={sourcePage} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-foreground">
                View listing page
              </a>
            </>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={busy || saved}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "shrink-0" })}
      >
        {busy ? <Loader2Icon className="animate-spin" /> : <BookmarkIcon />}
        {saved ? "Saved" : "Save"}
      </button>
      {err && <p className="text-[11px] text-muted-foreground">{err}</p>}
    </div>
  );
}
