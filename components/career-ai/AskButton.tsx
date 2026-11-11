"use client";
// "My fit" / "Relevant experience": one click calls /api/kb/ask for a job or startup and shows the grounded result in a dialog.
// Nothing runs until the button is pressed.
import { useState } from "react";
import { api, jsonBody } from "@/components/api";
import { AnswerView } from "./AnswerView";
import { kbErrorMessage, type Answer } from "./types";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2Icon, SparklesIcon } from "@/components/icons";

export function AskButton({ mode, jobId, startupId, label, title, description, size = "sm", variant = "outline" }: {
  mode: "job_match" | "startup_fit";
  jobId?: number;
  startupId?: number;
  label: string;
  title: string;
  description: string;
  size?: "sm" | "default" | "xs";
  variant?: "outline" | "ghost" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setOpen(true);
    if (res || busy) return;
    setBusy(true);
    setErr(null);
    const r = await api<Answer & { message?: string; error?: string }>("/api/kb/ask", { method: "POST", timeoutMs: 85_000, ...jsonBody({ mode, job_id: jobId, startup_id: startupId }) });
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setErr(kbErrorMessage(r.status, r.data?.error, r.data?.message ?? r.error));
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={run}>
        <SparklesIcon /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2Icon className="size-4 animate-spin" /> Checking your projects and experience…
            </p>
          )}
          {err && (
            <Banner tone="error" action={<Button size="sm" variant="outline" onClick={() => { setErr(null); void run(); }}>Retry</Button>}>{err}</Banner>
          )}
          {res && <AnswerView a={res} compact />}
        </DialogContent>
      </Dialog>
    </>
  );
}
