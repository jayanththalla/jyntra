"use client";
// "Use my verified experience": fetches grounded evidence for this startup on click and lets the user insert it into the draft. Never sends anything.
import { useState } from "react";
import { api, jsonBody } from "@/components/api";
import { AnswerView } from "./AnswerView";
import { kbErrorMessage, type Answer } from "./types";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Loader2Icon, ShieldCheckIcon } from "@/components/icons";

export function EvidenceHelper({ startupId, jobId, onInsert }: { startupId: number; jobId?: number; onInsert: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const r = await api<Answer & { message?: string; error?: string }>("/api/kb/ask", { method: "POST", timeoutMs: 85_000, ...jsonBody({ mode: "resume_outreach", question: "Which of my verified projects and skills are most relevant to this startup? Write 2-3 sentences I can use in an outreach message.", startup_id: startupId, job_id: jobId, save: false }) });
    setBusy(false);
    if (r.ok) setRes(r.data); else setErr(kbErrorMessage(r.status, r.data?.error, r.data?.message ?? r.error));
  }
  const plain = (a: Answer) => a.answer.replace(/\s*\[[SP]\d+\]/g, "").trim();
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="xs" onClick={run} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />} Use my verified experience
      </Button>
      {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
      {res && (
        <div className="space-y-2 rounded-lg border border-border/70 p-3">
          <AnswerView a={res} compact />
          {!res.insufficient && (
            <div className="flex gap-2">
              <Button type="button" size="xs" onClick={() => { onInsert(plain(res)); setRes(null); }}>Insert into draft</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setRes(null)}>Dismiss</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
