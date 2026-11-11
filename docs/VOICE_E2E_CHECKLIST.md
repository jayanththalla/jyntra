# Voice interview: authorised end-to-end checklist

Run on a real deployment with real keys. Mark the feature "fully integrated" only when every box is ticked.

Setup
- [ ] `GROQ_API_KEY` or `GEMINI_API_KEY`, and `SARVAM_API_KEY` set; start-up log shows `voice: stt=sarvam tts=sarvam llm=... text-only=true`.
- [ ] Page shows all three capabilities as configured. Use HTTPS (the mic needs a secure page).

Microphone
- [ ] Start with Speak: browser asks for mic permission. Deny it: a clear message and a "Use text only" action appear, and no session is created.
- [ ] Allow it: "Recording" indicator shows while the mic is on; the mic indicator in the browser turns off after Stop.

Speech to text
- [ ] Record a ~20 s English answer: transcript appears for review, nothing is saved yet.
- [ ] Edit a word and Accept: the next question refers to what you said.
- [ ] Discard and re-record: the discarded text never appears in later questions.
- [ ] Record silence: "No speech recognised" and you can record again.
- [ ] Record >90 s: rejected with a clear message.

Interviewer and speech
- [ ] First question is spoken in English even if the instruction was written in another language.
- [ ] Replay, Pause, Resume and Stop work; a new question never overlaps the old sound.
- [ ] Temporarily break SARVAM_API_KEY: the question stays readable as text, with the browser-voice option.

Persistence and privacy
- [ ] Leave mid-session, reopen from Past sessions, Resume continues at the same question.
- [ ] Without the consent box no recording is stored; with it, recordings appear, can be deleted, and expire after the retention period.
- [ ] A second account cannot open the first account's session (404).
- [ ] Server logs contain no transcripts, audio or keys.

Evaluation
- [ ] End after 3+ answers: Spoken English and Answer quality sections both appear, with the "AI estimate" label and limitations.
- [ ] Copy, Markdown and JSON export work; Delete session removes everything.

Mobile
- [ ] On a phone-width screen there is no horizontal scroll and all buttons are reachable.
