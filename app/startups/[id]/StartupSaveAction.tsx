"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookmarkCheckIcon, BookmarkIcon } from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Save / Unsave a startup. Only a plain "Saved" entry can be removed here: once a startup has been tracked
 * (Applied, Interview, …) it has history, so it is shown as tracked and managed in the Applications Tracker.
 */
export function StartupSaveAction({ startupId, saved }: { startupId: number; saved: { id: number; status: string } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(res.status === 401 ? "Please finish your profile first." : "Could not update. Try again.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (saved && saved.status !== "Saved") {
    return (
      <span className={buttonVariants({ variant: "outline" })}>
        <BookmarkCheckIcon /> {saved.status}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      {saved ? (
        <Button variant="outline" disabled={busy} onClick={() => run(`/api/applications/${saved.id}`, { method: "DELETE" })} aria-label="Remove this startup from your saved list">
          <BookmarkCheckIcon /> Saved · Unsave
        </Button>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => run("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startup_id: startupId, job_id: null, status: "Saved" }) })}>
          <BookmarkIcon /> Save
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
