# Jyntra

> **AI-Powered Career Intelligence & Startup Job Discovery Platform**

Live Application: [https://jyntra.vercel.app](https://jyntra.vercel.app)

---

## Overview

**Jyntra** is an open, modern career platform designed to help developers and job seekers find verified startup opportunities, understand their role fit, prepare for interviews, and manage applications in a single unified workspace.

---

## Key Features

- **Startup & Job Discovery (`/discover`)**  
  Aggregates verified openings directly from startup career boards (Greenhouse, Lever, Ashby, YC, Himalayas). Distinguishes between verified company postings, third-party listings, and funding signals so you always know where data comes from.

- **Kanban Application Tracker (`/applications`)**  
  A drag-and-drop Kanban board to organize job applications across stages:
  - *Saved*, *Applied*, *Interviewing*, *Offer*, and *Closed*.
  - Full details page (`/applications/[id]`) for each application with auto-saving notes, outreach history, and reminders.

- **Atlas AI (`/career-ai`)**  
  AI career assistant grounded in your own uploaded documents, projects, and notes. Ask career questions and draft materials with cited context from your background.

- **AI Mock Interview (`/mock-interview`)**  
  Practice technical and behavioral interviews with real-time feedback, formal assessments, and voice interview support.

- **Open Source Discovery (`/open-source`)**  
  Curated, beginner-friendly GitHub issues and open-source programs to help developers build proof-of-work and contribute to real-world software.

- **Funding Intelligence (`/news`)**  
  Track recent startup funding rounds and venture signals with direct source attribution.

- **Personalized Outreach (`/outreach`)**  
  Generate context-aware cold outreach drafts for startup founders and hiring managers with explicit preview confirmation before anything is sent.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19
- **Language:** TypeScript
- **Styling & UI:** Tailwind CSS v4, shadcn/ui, Motion, Lucide & Hugeicons
- **Database:** PostgreSQL (with Neon serverless driver support)
- **AI Integrations:** Groq, Google Gemini, OpenAI Realtime
- **Deployment:** Vercel

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (local Docker or managed cloud instance like Neon)
- npm or pnpm

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jayanththalla/jyntra.git
   cd jyntra
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your database connection (`DATABASE_URL`) and any optional API keys (e.g. `GROQ_API_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN`).

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Verification & Testing

| Command | Description |
|---|---|
| `npm run typecheck` | Run TypeScript type checks (`tsc --noEmit`) |
| `npm test` | Run unit and logic tests |
| `npm run build` | Test production build |
| `npm run check:sources` | Test reachability of external data providers |

---

## Contributing

Open source contributions are warmly encouraged and appreciated! Whether you are fixing bugs, improving documentation, designing UI enhancements, or adding new job-source integrations:

1. **Fork** the repository.
2. **Create a branch** for your feature:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit** your changes:
   ```bash
   git commit -m "feat: add amazing feature"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request** describing your changes.

Please make sure all tests and type checks pass (`npm run typecheck && npm test`) before submitting a pull request.

---

## License

This project is licensed under the [MIT License](LICENSE).
