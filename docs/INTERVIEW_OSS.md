# Open-source AI interview projects (checked 2026-10-28)

Found via GitHub's `ai-interviewer` topic and searches; "licence" is the `LICENSE` file on the default branch.
**No code from these projects is included in Jyntra.** `/mock-interview` is our own implementation on the existing AI layer (`lib/ai/outreach.ts → completeText`); the projects below shaped the design and are linked from that page.

| Repo | Licence | What it does | What we took from the idea |
|---|---|---|---|
| RezaSi/go-interview-practice | MIT | Go coding challenges, AI interview simulation, leaderboards (2.5k stars, updated Oct 2026) | Instant per-answer feedback |
| spelcaster/raulf-the-recruiter | MIT | Voice interview coach with fluency and answer-quality feedback | One question at a time, voice in/out, follow-up questions |
| aftabalam999/AI-Interviewer | MIT | MERN platform: resume analysis, RAG, voice interviews | Questions tailored to the candidate's real profile |
| ccd97/SystemDesign.ai | MIT | System-design mock interviewer | The "System design" track |
| souzataniya/Proof-Of-Synergy | MIT | Interview twin that tests resume claims | Using the profile's projects as question material |
| daftpunkwav/real-mock | MIT | Mock interviews with resume review and live voice rooms | Session summary with a per-question score |
| StephaneWamba/InterviewLab | none found | Voice interview prep with a code sandbox | Not used or linked (no licence file) |

Not adopted: running a full third-party stack (MERN, Go, Python voice servers) inside this Next.js app would add services to host and secure, for features the built-in version already covers.

## Note (voice interview)
No external voice-interview repository was supplied or copied. The voice interview is written in this codebase against the providers' official API docs. Any open-source code considered later needs a licence review first.


The in-app list of third-party interview projects was removed: the mock and voice interviews are Jyntra's own code and no third-party repository names appear in the interface.
