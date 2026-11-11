"use client";
// Voice interview (Career tools). The browser records, the server transcribes, YOU review the text, and only accepted text reaches the
// interviewer. Every control works with the keyboard; a text-only mode works with no speech services at all.
import { Skeleton } from "@/components/Skeleton";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { SelectField } from "@/components/SelectField";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RealtimePanel } from "./RealtimePanel";
import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon, MicIcon, RotateCcwIcon, Trash2Icon, VolumeIcon, XIcon } from "@/components/icons";
import { AudioPlayer, classifyMicError, initialReview, pickRecorderMime, reviewReducer, voiceErrorAdvice, type MicProblem, type PlayerState } from "@/lib/voice/client";
import { DIFFICULTIES, MODES, MODE_LABEL, type VoiceMode } from "@/lib/voice/interviewer";
import { evaluationToMarkdown, type Evaluation } from "@/lib/voice/evaluation";
import type { Capabilities } from "@/lib/voice/config";
import { cn } from "@/lib/utils";

interface Turn { idx: number; role: "interviewer" | "candidate"; text: string }
interface SessionView {
  session: { id: number; mode: VoiceMode; difficulty: string; role: string; status: "active" | "completed"; input_mode: "voice" | "text"; max_turns: number; retain_audio: boolean; evaluation: Evaluation | null; created_at: string };
  turns: Turn[]; recordings: number; remaining: { turns: number; seconds: number };
}
interface ListItem { id: number; mode: VoiceMode; role: string; status: string; input_mode: string; created_at: string; has_evaluation: boolean; answers: number }
type TtsChoice = "server" | "browser" | "off";

const eb = (r: { data: unknown }) => (r.data ?? {}) as { message?: string; error?: string; answerSaved?: boolean };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function VoiceInterview() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [history, setHistory] = useState<ListItem[]>([]);
  const [cur, setCur] = useState<SessionView | null>(null);
  const [notice, setNotice] = useState<{ tone: "warn" | "error" | "info"; text: string } | null>(null);

  const refreshHistory = useCallback(async () => {
    const r = await api<{ sessions: ListItem[] }>("/api/voice/sessions");
    if (r.ok) setHistory(r.data.sessions);
  }, []);
  useEffect(() => {
    (async () => {
      const c = await api<{ capabilities: Capabilities }>("/api/voice/capabilities");
      if (c.ok) setCaps(c.data.capabilities); else setLoadErr(c.error);
      refreshHistory();
    })();
  }, [refreshHistory]);

  if (loadErr) return <Banner tone="error">The voice interview could not load. {loadErr}</Banner>;
  if (!caps) return <Skeleton variant="form" count={1} />;

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        This is a <strong className="text-foreground">practice simulation</strong>, not a real employer interview. The interviewer is an AI model and only knows what you give it.
      </p>
      {notice && <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Banner>}
      {cur ? (
        cur.session.status === "completed" && cur.session.evaluation ? (
          <Report v={cur} onClose={() => { setCur(null); refreshHistory(); }} onDeleted={() => { setCur(null); refreshHistory(); }} />
        ) : (
          <Session v={cur} caps={caps} setV={setCur} onDone={(v) => { setCur(v); refreshHistory(); }} onNotice={setNotice} onLeave={() => { setCur(null); refreshHistory(); }} />
        )
      ) : (
        <>
          <Setup caps={caps} onStarted={(v) => { setNotice(null); setCur(v); }} onNotice={setNotice} />
          <History items={history} onOpen={async (id) => { const r = await api<SessionView>(`/api/voice/sessions/${id}`); if (r.ok) setCur(r.data); else setNotice({ tone: "error", text: r.error ?? "Could not open that session." }); }} onChanged={refreshHistory} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- setup
function Setup({ caps, onStarted, onNotice }: { caps: Capabilities; onStarted: (v: SessionView) => void; onNotice: (n: { tone: "warn" | "error" | "info"; text: string } | null) => void }) {
  const [mode, setMode] = useState<VoiceMode>("technical");
  const [input, setInput] = useState<"voice" | "text">(caps.spoken ? "voice" : "text");
  const [difficulty, setDifficulty] = useState("medium");
  const [role, setRole] = useState("");
  const [topics, setTopics] = useState("");
  const [seed, setSeed] = useState("");
  const [jd, setJd] = useState("");
  const [tts, setTts] = useState<TtsChoice>(caps.tts.provider === "sarvam" ? "server" : caps.tts.browserFallback ? "browser" : "off");
  const [retain, setRetain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micProblem, setMicProblem] = useState<string | null>(null);

  async function start() {
    setBusy(true); setMicProblem(null); onNotice(null);
    if (input === "voice") {
      // Ask for the microphone BEFORE creating a session, so a denial never leaves a half-started interview behind.
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw Object.assign(new Error("x"), { name: "UnsupportedError" });
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        setMicProblem(classifyMicError(e).message); setBusy(false); return;
      }
    }
    const r = await api<SessionView>("/api/voice/sessions", { method: "POST", timeoutMs: 60_000, ...jsonBody({ mode, difficulty, role, topics: topics.split(",").map((t) => t.trim()).filter(Boolean), seed_instruction: seed, job_description: jd, input_mode: input, retain_audio: input === "voice" && retain, consent_audio: input === "voice" && retain }) });
    setBusy(false);
    if (!r.ok) { onNotice({ tone: "error", text: eb(r).message ?? r.error ?? "Could not start." }); return; }
    try { sessionStorage.setItem(`voice-tts-${r.data.session.id}`, tts); } catch {}
    onStarted(r.data);
  }

  const status = (ok: boolean, label: string, why?: string) => (
    <li className={cn("flex items-center gap-1.5 text-xs", ok ? "text-foreground" : "text-muted-foreground")}>
      {ok ? <CheckIcon className="size-3.5 text-success" /> : <XIcon className="size-3.5" />}{label}{!ok && why ? <span className="text-muted-foreground"> · {why}</span> : null}
    </li>
  );

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-base font-semibold">Start a session</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="What is configured on this server">
          {status(caps.llm.configured, "Interviewer model", caps.llm.reason)}
          {status(caps.stt.configured, "Speech-to-text", caps.stt.reason)}
          {status(caps.tts.configured, "Spoken questions", caps.tts.reason)}
        </ul>
        {!caps.llm.configured && <Banner tone="warn">The interviewer needs an AI key on the server. Nothing can start until one is configured.</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="v-mode">Mode</Label><SelectField id="v-mode" aria-label="Interview mode" value={mode} onValueChange={(v) => setMode(v as VoiceMode)} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-diff">Difficulty</Label><SelectField id="v-diff" aria-label="Difficulty" value={difficulty} onValueChange={setDifficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-role">Target role</Label><Input id="v-role" value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend engineer" /></div>
          <div className="space-y-1.5"><Label htmlFor="v-topics">Topics (comma separated)</Label><Input id="v-topics" value={topics} maxLength={300} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. PostgreSQL, REST APIs" /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="v-seed">Instruction for the interviewer (any language; the interview stays in English)</Label><Textarea id="v-seed" value={seed} maxLength={600} rows={2} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. Focus on the database design of my project" /></div>
        <div className="space-y-1.5"><Label htmlFor="v-jd">Job description (optional)</Label><Textarea id="v-jd" value={jd} maxLength={4000} rows={3} onChange={(e) => setJd(e.target.value)} /></div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How you will answer</legend>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={input === "voice" ? "default" : "outline"} aria-pressed={input === "voice"} disabled={!caps.spoken} onClick={() => setInput("voice")}><MicIcon /> Speak</Button>
            <Button type="button" variant={input === "text" ? "default" : "outline"} aria-pressed={input === "text"} onClick={() => setInput("text")}>Type (text only)</Button>
          </div>
          {!caps.spoken && <p className="text-xs text-muted-foreground">Speaking is unavailable: {(caps.stt.reason ?? caps.llm.reason ?? "").replace(/\.$/, "")}.{caps.textOnly ? " The text-only interview works without it." : ""}</p>}
        </fieldset>
        {input === "voice" && (
          <>
            <div className="space-y-1.5"><Label htmlFor="v-tts">Interviewer voice</Label><SelectField id="v-tts" aria-label="Interviewer voice" value={tts} onValueChange={(v) => setTts(v as TtsChoice)} options={[...(caps.tts.provider === "sarvam" ? [{ value: "server", label: "Server voice (Sarvam)" }] : []), ...(caps.tts.browserFallback ? [{ value: "browser", label: "This browser's voice" }] : []), { value: "off", label: "Text only (no voice)" }]} /></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={retain} onChange={(e) => setRetain(e.target.checked)} />
              <span>Keep my recordings for {caps.limits.audioRetentionDays} days so I can replay them. <span className="text-muted-foreground">Off by default: recordings are otherwise discarded right after transcription. You can delete them any time.</span></span></label>
            <p className="text-xs text-muted-foreground">Your browser will ask for microphone access. The microphone is only on while you record an answer, and the page shows when it is.</p>
          </>
        )}
        {micProblem && <Banner tone="error" action={<Button size="sm" variant="outline" onClick={() => { setInput("text"); setMicProblem(null); }}>Use text only</Button>}>{micProblem}</Banner>}
        <Button onClick={start} disabled={busy || !caps.llm.configured || (input === "voice" && !caps.spoken)}>{busy ? <Loader2Icon className="animate-spin" /> : null} Start interview</Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- live session
function Session({ v, caps, setV, onDone, onNotice, onLeave }: { v: SessionView; caps: Capabilities; setV: (v: SessionView) => void; onDone: (v: SessionView) => void; onNotice: (n: { tone: "warn" | "error" | "info"; text: string } | null) => void; onLeave: () => void }) {
  const id = v.session.id;
  const voice = v.session.input_mode === "voice";
  const ttsChoice = useMemo<TtsChoice>(() => { try { return (sessionStorage.getItem(`voice-tts-${id}`) as TtsChoice) ?? (caps.tts.provider === "sarvam" ? "server" : "browser"); } catch { return "browser"; } }, [id, caps]);
  const last = v.turns[v.turns.length - 1];
  const question = [...v.turns].reverse().find((t) => t.role === "interviewer");
  const asked = v.turns.filter((t) => t.role === "interviewer").length;
  const awaitingQuestion = last?.role === "candidate"; // model failed after the answer was saved
  const [review, dispatch] = useReducer(reviewReducer, initialReview);
  const [player, setPlayer] = useState<{ state: PlayerState; turn: number | null }>({ state: "idle", turn: null });
  const [voiceFallback, setVoiceFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState<"retry" | "end" | null>(null);
  const [typed, setTyped] = useState("");
  const [recSecs, setRecSecs] = useState(0);
  const [err, setErr] = useState<{ message: string; suggestText: boolean } | null>(null);
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: ReturnType<typeof setInterval> } | null>(null);
  const lastBlob = useRef<{ blob: Blob; ms: number } | null>(null);
  const spoken = useRef<number | null>(null);
  const lastView = useRef<SessionView | null>(null);   // newest view returned by an accepted answer (the live-voice panel reads the next question from it)

  // One player per session: a new question stops the previous sound; leaving the page releases everything.
  const audioPlayer = useMemo(() => new AudioPlayer({
    createAudio: () => new Audio() as never,
    fetchAudio: async (turnIdx, signal) => {
      const res = await fetch(`/api/voice/sessions/${id}/speak`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idx: turnIdx }) });
      if (!res.ok) throw new Error("tts");
      return URL.createObjectURL(await res.blob());
    },
    revoke: (u) => URL.revokeObjectURL(u),
  }, (state, turn) => setPlayer({ state, turn })), [id]);
  useEffect(() => () => { audioPlayer.dispose(); window.speechSynthesis?.cancel(); stopRecorder(true); }, [audioPlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  const speakBrowser = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "en-IN";
    window.speechSynthesis.speak(u);
  }, []);
  const speakTurn = useCallback(async (t: Turn) => {
    if (!voice || ttsChoice === "off") return;
    if (ttsChoice === "browser") { audioPlayer.stop(); speakBrowser(t.text); return; }
    window.speechSynthesis?.cancel();
    await audioPlayer.play(t.idx);
  }, [voice, ttsChoice, audioPlayer, speakBrowser]);

  // Speak each new interviewer question once.
  useEffect(() => {
    if (question && voice && !awaitingQuestion && spoken.current !== question.idx) { spoken.current = question.idx; void speakTurn(question); }
  }, [question, voice, awaitingQuestion, speakTurn]);
  // Server voice failed: keep the text and offer the browser's voice when this browser has one.
  useEffect(() => {
    if (player.state === "error" && ttsChoice === "server") setVoiceFallback("The server voice isn't available right now. The question is shown as text." + ("speechSynthesis" in window ? " You can use your browser's voice instead." : ""));
    else if (player.state === "playing") setVoiceFallback(null);
  }, [player.state, ttsChoice]);

  function stopRecorder(discard = false) {
    const r = recorder.current;
    if (!r) return;
    clearInterval(r.timer);
    r.rec.onstop = discard ? null : r.rec.onstop;
    if (r.rec.state !== "inactive") r.rec.stop();
    r.stream.getTracks().forEach((t) => t.stop()); // the microphone is released as soon as recording ends
    if (discard) recorder.current = null;
  }

  async function record() {
    setErr(null); audioPlayer.stop(); window.speechSynthesis?.cancel();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setErr({ message: classifyMicError(e).message, suggestText: true }); return; }
    const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch (e) { stream.getTracks().forEach((t) => t.stop()); setErr({ message: classifyMicError(e).message, suggestText: true }); return; }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const started = Date.now();
    rec.onstop = () => {
      const ms = Date.now() - started;
      lastBlob.current = { blob: new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), ms };
      recorder.current = null;
      void transcribe();
    };
    const timer = setInterval(() => { const s = Math.round((Date.now() - started) / 1000); setRecSecs(s); if (s >= caps.limits.maxAudioSeconds) stopRecording(); }, 500);
    recorder.current = { rec, stream, chunks, started, timer };
    setRecSecs(0); dispatch({ type: "record" }); rec.start();
  }
  function stopRecording() { dispatch({ type: "stop" }); stopRecorder(); }

  async function transcribe() {
    const b = lastBlob.current;
    if (!b) return;
    const form = new FormData();
    form.append("audio", b.blob, "answer"); form.append("duration_ms", String(b.ms));
    let res: Response;
    try { res = await fetch(`/api/voice/sessions/${id}/transcribe`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) }); }
    catch { dispatch({ type: "failed", message: "Couldn't reach the server. Check your connection and try again.", retryable: true }); setErr({ message: "Couldn't reach the server. Check your connection and try again.", suggestText: false }); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const a = voiceErrorAdvice(data.error); dispatch({ type: "failed", message: data.message ?? a.message, retryable: !!data.retryable }); setErr({ message: data.message ?? a.message, suggestText: a.suggestText }); return; }
    dispatch({ type: "transcribed", text: data.transcript.text, stt: { provider: data.transcript.provider, language: data.transcript.language, segments: data.transcript.segments, confidence: data.transcript.confidence } });
  }

  async function submit(text: string, edited: boolean, stt: unknown) {
    setErr(null);
    const r = await api<{ view: SessionView; finished: boolean }>(`/api/voice/sessions/${id}/turn`, { method: "POST", timeoutMs: 60_000, ...jsonBody({ text, edited, stt }) });
    if (!r.ok) {
      dispatch({ type: "submit_failed", message: "" });
      if (eb(r).answerSaved) { const refreshed = await api<SessionView>(`/api/voice/sessions/${id}`); if (refreshed.ok) setV(refreshed.data); }
      setErr({ message: eb(r).message ?? r.error ?? "Could not save that answer.", suggestText: false });
      return false;
    }
    // Keep the recording only for sessions started with consent, and only for an accepted answer.
    if (v.session.retain_audio && lastBlob.current && stt) {
      const turnIdx = (last?.idx ?? 0) + 1; const f = new FormData(); f.append("audio", lastBlob.current.blob, "answer"); f.append("turn_idx", String(turnIdx));
      void fetch(`/api/voice/sessions/${id}/recordings`, { method: "POST", body: f }).catch(() => {});
    }
    lastBlob.current = null; dispatch({ type: "accepted" }); setTyped(""); lastView.current = r.data.view; setV(r.data.view);
    if (r.data.finished) await endSession(r.data.view);
    return true;
  }
  async function retryQuestion() {
    setBusy("retry"); setErr(null);
    const r = await api<{ view: SessionView }>(`/api/voice/sessions/${id}/turn`, { method: "POST", timeoutMs: 60_000, ...jsonBody({ retry: true }) });
    setBusy(null);
    if (r.ok) setV(r.data.view); else setErr({ message: eb(r).message ?? r.error ?? "Try again.", suggestText: false });
  }
  async function endSession(_?: SessionView) {
    setBusy("end"); setErr(null); audioPlayer.stop(); window.speechSynthesis?.cancel();
    const r = await api<{ evaluation: Evaluation; view: SessionView }>(`/api/voice/sessions/${id}/end`, { method: "POST", timeoutMs: 90_000 });
    setBusy(null);
    if (r.ok) onDone(r.data.view);
    else { setErr({ message: eb(r).message ?? r.error ?? "Could not create the evaluation.", suggestText: false }); if (eb(r).error === "no_answers") onNotice({ tone: "info", text: "Answer at least one question first." }); }
  }
  async function discardSession() {
    if (!confirm("Delete this session and its recordings?")) return;
    const r = await api(`/api/voice/sessions/${id}`, { method: "DELETE" });
    if (r.ok) onLeave();
  }

  const inReview = review.phase === "review" || review.phase === "submitting";
  const answers = v.turns.filter((t) => t.role === "candidate").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{MODE_LABEL[v.session.mode]} · {v.session.difficulty} · question {Math.min(asked, v.session.max_turns)} of {v.session.max_turns}</span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onLeave}>Pause and leave</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={discardSession}><Trash2Icon /> Delete</Button>
        </span>
      </div>

      {question && (
        <Card><CardContent className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interviewer</p>
          <p className="text-base leading-relaxed" aria-live="polite" data-testid="question">{awaitingQuestion ? "Your answer was saved, but the next question could not be generated." : question.text}</p>
          {awaitingQuestion ? (
            <Button onClick={retryQuestion} disabled={busy === "retry"}>{busy === "retry" ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Try again</Button>
          ) : voice && ttsChoice !== "off" && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Question audio">
              {player.state === "loading" && <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><Loader2Icon className="size-3.5 animate-spin" /> Preparing audio…</span>}
              {ttsChoice === "server" ? (<>
                {player.state === "playing" ? <Button size="sm" variant="outline" onClick={() => audioPlayer.pause()}>Pause</Button> : player.state === "paused" ? <Button size="sm" variant="outline" onClick={() => audioPlayer.resume()}>Resume</Button> : null}
                <Button size="sm" variant="outline" onClick={() => question && speakTurn(question)} disabled={player.state === "loading"}><VolumeIcon /> {player.state === "idle" || player.state === "error" ? "Play" : "Replay"}</Button>
                <Button size="sm" variant="ghost" onClick={() => audioPlayer.stop()} disabled={player.state === "idle" || player.state === "error"}>Stop</Button>
              </>) : (<>
                <Button size="sm" variant="outline" onClick={() => question && speakTurn(question)}><VolumeIcon /> Replay</Button>
                <Button size="sm" variant="ghost" onClick={() => window.speechSynthesis?.cancel()}>Stop</Button>
              </>)}
              {voiceFallback && ttsChoice === "server" && (<span className="text-xs text-muted-foreground">{voiceFallback} {"speechSynthesis" in window && <Button size="sm" variant="link" className="h-auto p-0" onClick={() => question && speakBrowser(question.text)}>Read it aloud</Button>}</span>)}
            </div>
          )}
        </CardContent></Card>
      )}

      {!awaitingQuestion && voice && question && (
        <RealtimePanel sessionId={id} question={question.text} onAnswer={async (text, edited) => {
          const ok = await submit(text, edited, null);
          if (!ok) throw new Error("That answer could not be saved. Your text is kept.");
          const nv = lastView.current; const nq = nv ? [...nv.turns].reverse().find((t) => t.role === "interviewer") : null;
          return { nextQuestion: nv && nv.session.status === "completed" ? null : nq?.text ?? null };
        }} />
      )}

      {!awaitingQuestion && (
        <Card><CardContent className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answer</p>
          {voice && !inReview && review.phase !== "transcribing" && (
            review.phase === "recording" ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-destructive" role="status"><span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-destructive" /></span> Recording · {recSecs}s (max {caps.limits.maxAudioSeconds}s). The microphone is on.</p>
                <Button onClick={stopRecording}>Stop and transcribe</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2"><Button onClick={record}><MicIcon /> {review.phase === "error" ? "Record again" : "Record answer"}</Button></div>
            )
          )}
          {review.phase === "transcribing" && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2Icon className="size-4 animate-spin" /> Transcribing…</p>}
          {inReview && (
            <div className="space-y-2">
              <Label htmlFor="v-draft">Check what was heard, fix any mistakes, then accept. Nothing is sent to the interviewer until you accept.</Label>
              <Textarea id="v-draft" rows={4} value={review.draft.text} maxLength={2500} disabled={review.phase === "submitting"} onChange={(e) => dispatch({ type: "edit", text: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={async () => { dispatch({ type: "accept" }); await submit(review.draft.text, review.draft.edited, review.draft.stt); }} disabled={review.phase === "submitting" || review.draft.text.trim().length < 2}>{review.phase === "submitting" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Accept{review.draft.edited ? " (edited)" : ""}</Button>
                <Button variant="outline" onClick={() => { dispatch({ type: "discard" }); lastBlob.current = null; }} disabled={review.phase === "submitting"}><RotateCcwIcon /> Discard and record again</Button>
              </div>
            </div>
          )}
          {!voice && (
            <div className="space-y-2">
              <Label htmlFor="v-typed" className="sr-only">Your answer</Label>
              <Textarea id="v-typed" rows={4} value={typed} maxLength={2500} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer in English" />
              <Button onClick={async () => { dispatch({ type: "record" }); dispatch({ type: "stop" }); dispatch({ type: "transcribed", text: typed, stt: null }); dispatch({ type: "accept" }); await submit(typed, false, null); }} disabled={typed.trim().length < 2 || review.phase === "submitting"}>Submit answer</Button>
            </div>
          )}
          {err && (
            <Banner tone="error" action={err.suggestText && voice ? <Button size="sm" variant="outline" onClick={async () => { const r = await api(`/api/voice/sessions/${id}`); void r; onNotice({ tone: "info", text: "Start a text-only session to answer by typing; this session keeps its answers." }); }}>Why?</Button> : undefined}>{err.message}</Banner>
          )}
        </CardContent></Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => endSession()} disabled={busy === "end" || answers === 0}>{busy === "end" ? <Loader2Icon className="animate-spin" /> : null} End and get evaluation</Button>
        {answers === 0 && <span className="text-xs text-muted-foreground">Answer at least one question first.</span>}
        <span className="text-xs text-muted-foreground">{v.remaining.turns} question{v.remaining.turns === 1 ? "" : "s"} left · about {Math.max(1, Math.round(v.remaining.seconds / 60))} min left</span>
      </div>

      {v.turns.length > 1 && (
        <details className="rounded-lg border border-border/70 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Transcript so far (accepted answers only)</summary>
          <ol className="mt-2 space-y-2">{v.turns.map((t) => <li key={t.idx}><span className="font-medium">{t.role === "interviewer" ? "Interviewer" : "You"}:</span> {t.text}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- report
function Report({ v, onClose, onDeleted }: { v: SessionView; onClose: () => void; onDeleted: () => void }) {
  const e = v.session.evaluation!;
  const [copied, setCopied] = useState(false);
  const md = useMemo(() => evaluationToMarkdown(e, `${MODE_LABEL[v.session.mode]}, ${v.session.created_at.slice(0, 10)}`), [e, v]);
  const s = e.spoken_english, a = e.answer_quality;
  const row = (k: string, val: string) => <p><span className="font-medium">{k}:</span> {val}</p>;
  async function removeAudio() { await api(`/api/voice/sessions/${v.session.id}/recordings`, { method: "DELETE" }); }
  async function del() { if (confirm("Delete this session, its transcript, evaluation and recordings?")) { const r = await api(`/api/voice/sessions/${v.session.id}`, { method: "DELETE" }); if (r.ok) onDeleted(); } }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onClose}>Back</Button>
        <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }}><CopyIcon /> {copied ? "Copied" : "Copy report"}</Button>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted" href={`/api/voice/sessions/${v.session.id}/export?format=md`}><DownloadIcon className="size-4" /> Markdown</a>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted" href={`/api/voice/sessions/${v.session.id}/export?format=json`}><DownloadIcon className="size-4" /> JSON</a>
        {v.recordings > 0 && <Button variant="outline" onClick={removeAudio}>Delete {v.recordings} recording{v.recordings === 1 ? "" : "s"}</Button>}
        <Button variant="ghost" className="text-destructive" onClick={del}><Trash2Icon /> Delete session</Button>
      </div>
      <Card><CardContent className="space-y-2 text-sm">
        <h2 className="text-base font-semibold">Spoken English</h2>
        {row("Clarity", s.clarity)}{row("Grammar", s.grammar)}{row("Vocabulary", s.vocabulary)}
        {row(`Fillers found in the text (${s.word_count} words)`, s.fillers.length ? s.fillers.map((f) => `${f.word} ×${f.count}`).join(", ") : "none found")}
        <p><span className="font-medium">CEFR estimate:</span> {s.cefr_estimate.level === "insufficient" ? "not enough speech to estimate" : s.cefr_estimate.level} <span className="text-muted-foreground">({s.cefr_estimate.confidence} confidence · {s.cefr_estimate.label})</span>. {s.cefr_estimate.rationale}</p>
        {s.recommendations.length > 0 && <ul className="list-disc space-y-1 pl-5">{s.recommendations.map((x) => <li key={x}>{x}</li>)}</ul>}
        {s.practice_examples.length > 0 && <ul className="space-y-1">{s.practice_examples.map((p) => <li key={p.original}>“{p.original}” → <strong>“{p.better}”</strong></li>)}</ul>}
      </CardContent></Card>
      <Card><CardContent className="space-y-2 text-sm">
        <h2 className="text-base font-semibold">Interview answers</h2>
        {row("Relevance", a.relevance)}{row("Technical depth", a.technical_depth)}{row("Structure", a.structure)}{row("Evidence and trade-offs", a.evidence_and_tradeoffs)}
        {row(`Strongest (turn ${a.strongest.turn})`, a.strongest.why)}{row(`Weakest (turn ${a.weakest.turn})`, a.weakest.why)}
        {a.weakest.improved_answer && <div className="rounded-lg bg-muted/40 p-3"><p className="mb-1 font-medium">A stronger version of turn {a.weakest.turn}</p><p>{a.weakest.improved_answer}</p></div>}
        {a.follow_up_topics.length > 0 && <p><span className="font-medium">Practise next:</span> {a.follow_up_topics.join(", ")}</p>}
      </CardContent></Card>
      <Card><CardContent className="text-xs text-muted-foreground"><p className="mb-1 font-medium text-foreground">Limits of this report</p><ul className="list-disc space-y-0.5 pl-5">{e.limitations.map((l) => <li key={l}>{l}</li>)}</ul></CardContent></Card>
    </div>
  );
}

// ---------------------------------------------------------------- history
function History({ items, onOpen, onChanged }: { items: ListItem[]; onOpen: (id: number) => void; onChanged: () => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="vh" className="space-y-2">
      <h2 id="vh" className="text-sm font-semibold">Past sessions</h2>
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/60 p-3 text-sm">
            <span><span className="font-medium">{MODE_LABEL[s.mode]}</span> <span className="text-muted-foreground">· {when(s.created_at)} · {s.answers} answer{s.answers === 1 ? "" : "s"} · {s.status === "active" ? "unfinished" : "completed"}</span></span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => onOpen(s.id)}>{s.status === "active" ? "Resume" : "View report"}</Button>
              <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete session from ${when(s.created_at)}`} onClick={async () => { if (confirm("Delete this session and its recordings?")) { await api(`/api/voice/sessions/${s.id}`, { method: "DELETE" }); onChanged(); } }}><Trash2Icon /></Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
