"use client";
// Live two-way voice for an existing voice-interview session (WebRTC). The interviewer's QUESTIONS still come from our server (stored,
// one at a time); the realtime model only speaks them. You can interrupt at any time (barge-in). By default your spoken answer is shown as
// a transcript to review before it is sent; automatic send is an opt-in switch. If anything fails, recorded-answer voice and typing still work.
import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, MicIcon, RotateCcwIcon } from "@/components/icons";
import { RealtimeInterview } from "@/lib/voice/realtime-client";
import type { RtState } from "@/lib/voice/realtime-state";

type Caps = { configured: boolean; reason?: string | null };
const STATUS: Record<string, string> = {
  idle: "Not connected", connecting: "Connecting…", ready: "Listening: speak when you are ready", ai_speaking: "Interviewer is speaking (you can interrupt)",
  user_speaking: "Hearing you…", transcribing: "Transcribing…", reviewing: "Review your answer", submitting: "Sending your answer…", waiting_ai: "Interviewer is responding…", error: "Connection problem", closed: "Disconnected",
};

export function RealtimePanel({ sessionId, question, onAnswer }: { sessionId: number; question: string; onAnswer: (text: string, edited: boolean) => Promise<{ nextQuestion: string | null }> }) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [st, setSt] = useState<RtState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const ctl = useRef<RealtimeInterview | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const answerRef = useRef(onAnswer); answerRef.current = onAnswer;

  useEffect(() => { let off = false; void api<{ realtime?: Caps }>("/api/voice/capabilities").then((r) => { if (!off) setCaps(r.ok ? (r.data.realtime ?? { configured: false }) : { configured: false }); }); return () => { off = true; }; }, []);
  useEffect(() => () => { ctl.current?.close(); }, []);                       // leaving the page releases the microphone and the connection

  async function start() {
    setError(null);
    const c = new RealtimeInterview({
      fetchImpl: (u, i) => fetch(u, i), newPc: () => new RTCPeerConnection() as never,
      getMic: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) as never,
      setRemoteStream: (s) => { if (audio.current) audio.current.srcObject = s as MediaStream; },
      autoSubmit: auto, onState: setSt,
      submitAnswer: (text) => answerRef.current(text, text !== (st?.draft?.original ?? text)),
    }, sessionId);
    ctl.current = c;
    try { await c.connect(); c.speak(question); }
    catch (e) {
      const m = (e as { code?: string; message?: string });
      setError(m.code === "not_configured" || m.code === "unavailable" ? "Live voice isn't available right now. You can still record an answer or type it." : (e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser, or use recording/typing instead." : (m.message || "Could not start live voice. You can still record an answer or type it."));
    }
  }
  function stop() { ctl.current?.close(); ctl.current = null; setSt(null); }

  if (!caps) return null;
  if (!caps.configured) return <p className="text-xs text-muted-foreground">Live voice conversation isn&apos;t enabled on this server. Recording an answer and typing both work.</p>;
  const phase = st?.phase ?? "idle"; const live = !!st && !["idle", "closed", "error"].includes(phase);
  const bars = phase === "ai_speaking" || phase === "user_speaking";

  return (
    <Card><CardContent className="space-y-3">
      <audio ref={audio} autoPlay className="hidden" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live voice (beta)</p>
        <div className="flex items-center gap-2"><Switch id="rt-auto" checked={auto} onCheckedChange={(v) => { setAuto(v); ctl.current?.setAutoSubmit?.(v); }} disabled={live} /><Label htmlFor="rt-auto" className="text-xs">Send answers automatically</Label></div>
      </div>
      {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className={`flex h-6 items-end gap-0.5 ${bars ? "" : "opacity-30"}`} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`w-1 rounded bg-primary ${bars ? "animate-pulse" : ""}`} style={{ height: `${8 + ((i * 7) % 14)}px`, animationDelay: `${i * 90}ms` }} />)}</span>
        <span className="text-sm">{STATUS[phase]}</span>
        {st && st.interruptions > 0 && <span className="text-xs text-muted-foreground">interrupted {st.interruptions}×</span>}
      </div>
      {!live ? (
        <Button onClick={start} disabled={phase === "connecting"}>{phase === "connecting" ? <Loader2Icon className="animate-spin" /> : <MicIcon />} Start live voice</Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => ctl.current?.interrupt()} disabled={phase !== "ai_speaking"}>Stop interviewer</Button>
          <Button size="sm" variant="ghost" onClick={stop}>End live voice</Button>
        </div>
      )}
      {st?.partial && phase !== "reviewing" && <p className="rounded bg-muted/50 p-2 text-sm italic text-muted-foreground">{st.partial}</p>}
      {st?.draft && (phase === "reviewing" || phase === "submitting") && (
        <div className="space-y-2">
          <Label htmlFor="rt-draft">Check what was heard, fix any mistakes, then accept. Nothing is sent until you accept.</Label>
          <Textarea id="rt-draft" rows={4} value={st.draft.text} maxLength={2500} disabled={phase === "submitting"} onChange={(e) => ctl.current?.edit(e.target.value)} />
          {st.error && <p className="text-sm text-destructive" role="alert">{st.error} Your text is kept.</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => ctl.current?.accept()} disabled={phase === "submitting" || st.draft.text.trim().length < 2}>{phase === "submitting" ? <Loader2Icon className="animate-spin" /> : null} Accept and send</Button>
            <Button variant="outline" onClick={() => ctl.current?.rerecord()} disabled={phase === "submitting"}><RotateCcwIcon /> Discard and speak again</Button>
          </div>
        </div>
      )}
    </CardContent></Card>
  );
}
