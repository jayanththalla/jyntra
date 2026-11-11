// Browser WebRTC controller for a realtime interview. All side effects (peer connection, microphone, fetch, audio element) are
// injected, so the tests drive it with fakes. It holds NO permanent key: it asks OUR server for a short-lived credential and sends
// the SDP offer to the provider with it. Teardown stops every microphone track and closes the channel and the connection.
import { initialRt, step, fromOpenAiEvent, type RtEffect, type RtEvent, type RtState } from "./realtime-state";

export interface DcLike { readyState: string; send(data: string): void; close(): void; onmessage: ((e: { data: string }) => void) | null; onopen: (() => void) | null; onclose: (() => void) | null }
export interface PcLike {
  createDataChannel(label: string): DcLike; addTrack(t: unknown, s: unknown): void; createOffer(): Promise<{ sdp?: string; type: string }>;
  setLocalDescription(d: unknown): Promise<void>; setRemoteDescription(d: unknown): Promise<void>; close(): void;
  ontrack: ((e: { streams: unknown[] }) => void) | null; onconnectionstatechange: (() => void) | null; connectionState: string;
}
export interface MediaLike { getTracks(): { stop(): void }[] }
export interface RtDeps {
  fetchImpl: typeof fetch; newPc: () => PcLike; getMic: () => Promise<MediaLike>; setRemoteStream: (s: unknown) => void;
  now?: () => number; autoSubmit?: boolean;
  onState: (s: RtState) => void; onAiText?: (t: string) => void;
  /** Sends a confirmed answer to OUR server (which stores it and returns the next question). Resolves with the question text to speak, or null when the interview is over. */
  submitAnswer: (text: string, itemId: string) => Promise<{ nextQuestion: string | null }>;
}
interface Credential { value: string; expiresAt: number; connectUrl: string }

export class RealtimeInterview {
  private pc: PcLike | null = null; private dc: DcLike | null = null; private mic: MediaLike | null = null;
  state: RtState;
  constructor(private d: RtDeps, private sessionId: number) { this.state = initialRt(d.autoSubmit ?? false); }

  private dispatch(e: RtEvent) {
    const r = step(this.state, e); this.state = r.state; this.d.onState(this.state);
    for (const fx of r.effects) this.perform(fx);
  }
  private send(o: object) { if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(o)); }
  private perform(fx: RtEffect) {
    if (fx.type === "cancel_response") this.send({ type: "response.cancel" });
    else if (fx.type === "clear_output_audio") this.send({ type: "output_audio_buffer.clear" });
    else if (fx.type === "show_ai_text") this.d.onAiText?.(fx.text);
    else if (fx.type === "submit_answer") void this.submit(fx.text, fx.itemId);
  }
  private async submit(text: string, itemId: string) {
    try {
      const r = await this.d.submitAnswer(text, itemId);
      this.dispatch({ t: "submit_ok" });
      if (r.nextQuestion) this.speak(r.nextQuestion);
    } catch (e) { this.dispatch({ t: "submit_failed", message: (e as Error).message || "Could not send your answer. Your text is kept; try again." }); }
  }
  /** Reads a server-approved question aloud. The voice model is told to say exactly this and nothing else. */
  speak(question: string) {
    this.send({ type: "response.create", response: { instructions: `Read the following interview question aloud, naturally, and say nothing else: ${question.slice(0, 700)}` } });
  }
  private async credential(): Promise<Credential> {
    const now = this.d.now?.() ?? Date.now();
    const res = await this.d.fetchImpl(`/api/voice/sessions/${this.sessionId}/realtime-token`, { method: "POST" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(j?.message || "Realtime voice is not available."), { code: j?.error ?? "unavailable" }); }
    const c = (await res.json()) as Credential;
    if (!c?.value || c.expiresAt * 1000 <= now) throw Object.assign(new Error("The voice credential had already expired. Try again."), { code: "expired" });
    return c;
  }
  async connect(): Promise<void> {
    this.dispatch({ t: "connecting" });
    try {
      let cred = await this.credential();
      this.mic = await this.d.getMic();
      const pc = (this.pc = this.d.newPc());
      pc.ontrack = (e) => this.d.setRemoteStream(e.streams[0]);
      pc.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(pc.connectionState)) this.dispatch({ t: "closed" }); };
      for (const t of this.mic.getTracks()) pc.addTrack(t, this.mic);
      const dc = (this.dc = pc.createDataChannel("oai-events"));
      dc.onmessage = (m) => { try { const ev = fromOpenAiEvent(JSON.parse(m.data)); if (ev) this.dispatch(ev); } catch { /* ignore malformed frames */ } };
      dc.onopen = () => this.dispatch({ t: "connected" });
      dc.onclose = () => this.dispatch({ t: "closed" });
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      let r = await this.d.fetchImpl(cred.connectUrl, { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${cred.value}`, "Content-Type": "application/sdp" } });
      if (r.status === 401) { cred = await this.credential(); r = await this.d.fetchImpl(cred.connectUrl, { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${cred.value}`, "Content-Type": "application/sdp" } }); }   // expired credential: one fresh attempt
      if (!r.ok) throw Object.assign(new Error("The voice service refused the connection."), { code: "connect_failed" });
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    } catch (e) { this.dispatch({ t: "error", message: (e as Error).message }); this.close(); throw e; }
  }
  /** Changes automatic submission for the rest of this connection. */
  setAutoSubmit(on: boolean) { this.dispatch({ t: "set_auto_submit", on }); }
  accept() { this.dispatch({ t: "accept" }); }
  edit(text: string) { this.dispatch({ t: "edit", text }); }
  rerecord() { this.dispatch({ t: "rerecord" }); }
  /** User pressed Stop: interrupt the interviewer immediately. */
  interrupt() { this.send({ type: "response.cancel" }); this.send({ type: "output_audio_buffer.clear" }); }
  close() {
    for (const t of this.mic?.getTracks() ?? []) { try { t.stop(); } catch { /* already stopped */ } }
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    this.mic = this.dc = this.pc = null;
    if (this.state.phase !== "closed" && this.state.phase !== "error") this.dispatch({ t: "closed" });
  }
}
