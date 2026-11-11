// Validation of uploaded recordings BEFORE they are sent to a provider or stored. The browser's claims (type, duration) are not trusted
// on their own: the declared type is checked against the file's magic bytes, size is measured, and WAV duration is read from the header.
export const ALLOWED_AUDIO: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/x-m4a": "mp4",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

export type AudioProblem = "empty" | "too_large" | "unsupported_type" | "type_mismatch" | "too_long" | "too_short";
export interface AudioCheck { ok: boolean; problem?: AudioProblem; kind?: string; durationSeconds?: number | null; mime?: string }

/** "audio/webm;codecs=opus" -> "audio/webm" */
export const baseMime = (m: string) => m.split(";")[0].trim().toLowerCase();

/** What the bytes say the file is, independent of what the browser claimed. */
export function sniff(b: Uint8Array): string | null {
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (s(0, 4) === "OggS") return "ogg";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "wav";
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return b[0] === 0xff && (b[1] & 0xf6) === 0xf0 ? "aac" : "mp3";
  if (s(4, 4) === "ftyp") return "mp4";
  if (s(0, 4) === "fLaC") return "flac";
  return null;
}

/** Duration in seconds from a PCM WAV header, or null when it can't be read. */
export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 44) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 12, byteRate = 0, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(...b.slice(off, off + 4));
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") byteRate = dv.getUint32(off + 16, true);
    if (id === "data") { dataLen = Math.min(size, b.length - off - 8); break; }
    off += 8 + size + (size % 2);
  }
  return byteRate > 0 && dataLen > 0 ? dataLen / byteRate : null;
}

export function checkAudio(b: Uint8Array, declaredMime: string, o: { maxBytes: number; maxSeconds: number; claimedSeconds?: number | null; minBytes?: number }): AudioCheck {
  if (!b.length || b.length < (o.minBytes ?? 800)) return { ok: false, problem: b.length ? "too_short" : "empty" };
  if (b.length > o.maxBytes) return { ok: false, problem: "too_large" };
  const mime = baseMime(declaredMime);
  const expected = ALLOWED_AUDIO[mime];
  if (!expected) return { ok: false, problem: "unsupported_type" };
  const actual = sniff(b);
  // mp4 audio and some aac streams share containers; accept the declared family when the sniffed kind is compatible.
  if (!actual || (actual !== expected && !(expected === "aac" && (actual === "mp4" || actual === "aac")) && !(expected === "mp3" && actual === "aac"))) return { ok: false, problem: "type_mismatch" };
  const seconds = actual === "wav" ? wavSeconds(b) : o.claimedSeconds ?? null;
  if (seconds !== null && seconds > o.maxSeconds) return { ok: false, problem: "too_long", durationSeconds: seconds };
  if (seconds !== null && seconds < 0.3) return { ok: false, problem: "too_short", durationSeconds: seconds };
  return { ok: true, kind: actual, durationSeconds: seconds, mime };
}
