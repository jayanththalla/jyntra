// Server-side PDF export of a saved ReportV2 (pdfkit: pure JavaScript, no browser or native binary, so it runs inside the existing
// Next.js deployment). The PDF is rendered from the SAME object the HTML/JSON report uses: it contains the actual saved data.
//  - A4, 54pt margins. Blocks that must stay together call need(); everything else flows and breaks pages automatically.
//  - Page numbers ("Page n of N") are written after layout, with the bottom margin temporarily zero so the footer cannot create pages.
//  - The built-in Helvetica font covers Latin-1 only. Other characters are transliterated or replaced rather than rendering as garbage.
//  - Size guards: at most 40 questions, each answer/feedback clipped, so a huge report cannot exhaust memory.
import PDFDocument from "pdfkit";
import type { ReportV2, QuestionRow } from "./report-v2";
import { CEFR_LABEL } from "./english";

const MAX_QUESTIONS = 40;
const C = { ink: "#1f2430", muted: "#5b6472", brand: "#5b3df5", rule: "#d9dce3", good: "#1f8f5f", warn: "#b7791f", bad: "#c0392b", track: "#e9ebf0" };
const M = 54;

const MAP: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "→": "->", "₹": "INR ", "€": "EUR ", "×": "x", "\u00a0": " ", "≥": ">=", "≤": "<=" };
export function pdfSafe(input: unknown, max = 1200): string {
  const s = String(input ?? "").replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u2022\u2192\u20B9\u20AC\u00D7\u00A0\u2265\u2264]/g, (c) => MAP[c] ?? c)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").normalize("NFC");
  // Keep Latin-1; replace anything else with "?" so the text stays readable and honest.
  return [...s].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : "?")).join("").replace(/[ \t]+/g, " ").trim().slice(0, max);
}
const scoreColor = (n: number | null) => (n === null ? C.muted : n >= 75 ? C.good : n >= 50 ? C.warn : C.bad);

export async function renderReportPdf(r: ReportV2, opts: { candidate?: string | null } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 60, bottom: 62, left: M, right: M }, bufferPages: true, info: { Title: pdfSafe(r.title, 100), Author: "Jyntra", Subject: "Mock interview report" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });

  const W = doc.page.width - M * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const need = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
  const H1 = (t: string) => { need(60); doc.moveDown(0.8); doc.font("Helvetica-Bold").fontSize(14).fillColor(C.brand).text(pdfSafe(t, 120), M, doc.y, { width: W }); const y = doc.y + 2; doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.7).strokeColor(C.rule).stroke(); doc.y = y + 8; doc.fillColor(C.ink); };
  const P = (t: string, o: { size?: number; color?: string; bold?: boolean; indent?: number; gap?: number } = {}) => {
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 10).fillColor(o.color ?? C.ink);
    doc.text(pdfSafe(t, 2000), M + (o.indent ?? 0), doc.y, { width: W - (o.indent ?? 0), lineGap: 2.2 }); doc.moveDown(o.gap ?? 0.35);
  };
  const bullets = (xs: string[], none = "None.") => { if (!xs.length) return P(none, { color: C.muted }); for (const x of xs) { need(26); P("- " + x, { indent: 8, gap: 0.2 }); } };
  const bar = (label: string, value: number | null, note?: string) => {
    need(24);
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(C.ink).text(pdfSafe(label, 40), M, y, { width: 150, lineBreak: false });
    doc.roundedRect(M + 155, y + 2, W - 215, 9, 3).fillColor(C.track).fill();
    if (value !== null) doc.roundedRect(M + 155, y + 2, Math.max(2, ((W - 215) * value) / 100), 9, 3).fillColor(scoreColor(value)).fill();
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(value === null ? C.muted : C.ink).text(value === null ? "n/a" : `${value}/100`, M + W - 50, y, { width: 50, align: "right", lineBreak: false });
    doc.y = y + 17; if (note) { P(note, { size: 8.5, color: C.muted, gap: 0.1 }); }
  };

  // 1. Title and candidate details
  doc.rect(0, 0, doc.page.width, 6).fill(C.brand);
  doc.font("Helvetica-Bold").fontSize(21).fillColor(C.ink).text(pdfSafe(r.title, 80), M, 40, { width: W });
  doc.font("Helvetica").fontSize(10).fillColor(C.muted).text("Jyntra - Mock interview practice", M, doc.y, { width: W });
  doc.moveDown(0.8);
  const kv: [string, string][] = [
    ["Candidate", opts.candidate ? pdfSafe(opts.candidate, 80) : "Not provided"], ["Role", pdfSafe(r.role, 100)],
    ["Interview type", `${pdfSafe(r.interviewType, 40).replace(/_/g, " ")} (${pdfSafe(r.level, 20)} level)`],
    ["Date", new Date(r.date).toISOString().slice(0, 10)], ["Duration", r.durationMinutes ? `${r.durationMinutes} minutes` : "Not recorded"],
    ["Questions", `${r.questionsAnswered} answered of ${r.questionsPlanned} planned`], ["Session type", r.kind === "formal" ? "Formal (timed) interview" : "Practice session"],
  ];
  for (const [k, v] of kv) { const y = doc.y; doc.font("Helvetica-Bold").fontSize(10).fillColor(C.muted).text(k, M, y, { width: 110, lineBreak: false }); doc.font("Helvetica").fillColor(C.ink).text(v, M + 115, y, { width: W - 115 }); doc.moveDown(0.15); }

  // 2-3. Summary and score overview
  H1("Interview summary");
  P(`Overall score ${r.scores.overall ?? "n/a"}${r.scores.overall !== null ? "/100" : ""}. ${r.confidence}`, { bold: true });
  if (r.legacyAnswers) P(`${r.legacyAnswers} answer(s) were saved before weighted scoring existed. They count in the overall score but have no dimension breakdown.`, { size: 9, color: C.muted });
  H1("Score overview");
  bar("Overall", r.scores.overall); bar("Technical", r.scores.technical); bar("Communication", r.scores.communication, r.scores.communication === null ? "Communication is scored on spoken answers only." : "From the words of your answers (transcript), not from how they sounded.");
  bar("Problem-solving", r.scores.problemSolving); bar("Behavioural", r.scores.behavioural);
  if (r.written) bar("Written test", r.written.score, `${r.written.correct} of ${r.written.answered} written questions correct`);

  // 4. Technical assessment
  H1("Technical assessment");
  const techRows = r.questions.filter((q) => q.kind === "technical");
  if (!techRows.length) P("No technical answers with a weighted breakdown in this session.", { color: C.muted });
  else {
    const dims = new Map<string, number[]>();
    for (const q of techRows) for (const c of q.components) dims.set(c.label, [...(dims.get(c.label) ?? []), c.score]);
    for (const [label, s] of dims) bar(label, Math.round(s.reduce((a, b) => a + b, 0) / s.length));
  }
  if (r.recurring.length) { P("Recurring weaknesses", { bold: true }); bullets(r.recurring); }

  // 5. Communication assessment (spoken English)
  H1("Communication assessment");
  if (!r.english) P("No spoken-English assessment was saved for this session.", { color: C.muted });
  else {
    const e = r.english;
    P(CEFR_LABEL, { size: 9, color: C.warn, bold: true });
    P(`Estimated level: ${e.level === "insufficient" ? "not enough evidence" : e.level}. Confidence: ${e.confidence}. ${e.eligibilityNote}`);
    P(`Basis: ${e.basis === "transcript" ? "transcript only (pronunciation, accent and sound were not assessed)" : "transcript plus measured speaking time"}.`, { size: 9, color: C.muted });
    if (e.scores) for (const [k, v] of Object.entries(e.scores)) bar(k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), v);
    P(`Filler words found: ${e.fillerWords.length ? e.fillerWords.map((f) => `${f.word} x${f.count}`).join(", ") : "none found"} (a lower bound: speech-to-text can drop fillers).`);
    P(e.pace.wpm === null ? e.pace.note : `Speaking pace: ${e.pace.wpm} words per minute. ${e.pace.note}`, { size: 9, color: C.muted });
    if (e.strongHabits.length) { P("Strong habits", { bold: true }); bullets(e.strongHabits); }
    if (e.grammarMistakes.length) { P("Grammar to fix", { bold: true }); bullets(e.grammarMistakes.map((g) => `"${g.original}" -> "${g.better}" (${g.why})`)); }
    if (e.vocabularyImprovements.length) { P("Vocabulary", { bold: true }); bullets(e.vocabularyImprovements.map((v) => `"${v.original}" -> "${v.better}"`)); }
    if (e.improvedAnswer) { need(60); P(`Improved version of answer ${e.improvedAnswer.answerNumber}`, { bold: true }); P(`Original: "${e.improvedAnswer.original}"`, { size: 9, color: C.muted, indent: 8 }); P(`Improved: "${e.improvedAnswer.improved}"`, { size: 9.5, indent: 8 }); }
    if (e.exercises.length) { P("Three exercises", { bold: true }); bullets(e.exercises); }
  }

  // 6. Individual question analysis
  H1("Individual question analysis");
  const qs = r.questions.slice(0, MAX_QUESTIONS);
  qs.forEach((q: QuestionRow, i) => {
    need(110);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.ink).text(`Q${i + 1}. ${pdfSafe(q.question, 400)}`, M, doc.y, { width: W - 70, continued: false });
    const yTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(scoreColor(q.score)).text(`${q.score}/100`, M + W - 66, yTop - (doc.heightOfString(pdfSafe(q.question, 400), { width: W - 70 })), { width: 66, align: "right", lineBreak: false });
    doc.y = yTop; doc.moveDown(0.15);
    P(`${q.kind === "legacy" ? "Saved before weighted scoring (legacy)" : q.kind === "behavioural" ? "Behavioural rubric" : "Technical rubric"} - ${q.attempts} attempt(s)${q.communication !== null ? ` - communication ${q.communication}/100` : ""}`, { size: 8.5, color: C.muted, gap: 0.2 });
    P(`Your answer: ${pdfSafe(q.answer, 700)}`, { size: 9, color: C.muted, indent: 8, gap: 0.2 });
    for (const c of q.components) P(`${c.label} (${c.weight}%): ${c.score}/100 - ${c.evidence}`, { size: 9, indent: 8, gap: 0.1 });
    if (q.verdict) P(`Feedback: ${q.verdict}`, { size: 9.5, indent: 8, gap: 0.2 });
    if (q.improvements.length) P(`To improve: ${q.improvements.join(" ")}`, { size: 9, indent: 8, gap: 0.2 });
    doc.moveDown(0.5);
  });
  if (r.questions.length > MAX_QUESTIONS) P(`Showing the first ${MAX_QUESTIONS} of ${r.questions.length} questions.`, { color: C.muted, size: 9 });

  // 7. Written test
  H1("Written test");
  if (!r.written) P(r.kind === "formal" ? "No written test result was saved for this session." : "Written tests are part of formal interviews.", { color: C.muted });
  else {
    P(`${r.written.correct} of ${r.written.answered} correct. Score ${r.written.score ?? "n/a"}${r.written.score !== null ? "/100" : ""}.`, { bold: true });
    for (const t of r.written.topics) bar(t.category, t.averageScore, `${t.correct} of ${t.answered} correct`);
    if (r.written.sql) P(`SQL tasks: ${r.written.sql.answered} attempted, score ${r.written.sql.score ?? "n/a"}${r.written.sql.score !== null ? "/100" : ""}.`);
  }

  // 8-10. Strengths, improvements, roadmap
  H1("Strengths");
  bullets(r.strongest.map((q) => `${q.score}/100 - "${q.question.slice(0, 120)}"`), "No answer scored 50 or above.");
  H1("Improvements");
  bullets(r.weakest.map((q) => `${q.score}/100 - "${q.question.slice(0, 120)}"`), "No answer scored below the 75 threshold.");
  H1("Personalised learning roadmap");
  if (r.recommendations.length) { P("What to work on", { bold: true }); bullets(r.recommendations); }
  if (r.nextPractice.length) { P("Next practice", { bold: true }); bullets(r.nextPractice); }
  if (!r.recommendations.length && !r.nextPractice.length) P("No specific gaps were found in this session. Try a harder level next time.", { color: C.muted });

  H1("Limits of this report");
  bullets(r.limitations);

  // Footer on every page, after layout.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(C.muted);
    doc.text(`Jyntra mock interview report - practice estimate, not a hiring decision`, M, doc.page.height - 36, { width: W - 80, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M + W - 80, doc.page.height - 36, { width: 80, align: "right", lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}
