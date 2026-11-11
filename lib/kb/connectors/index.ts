import type { Connector, Provider } from "../types";
import { githubConnector } from "./github";
import { codeforcesConnector } from "./codeforces";
import { leetcodeConnector } from "./leetcode";
import { gdocsConnector } from "./gdocs";
import { manualConnector, portfolioConnector } from "./manual";

/** Documents uploaded as files are stored directly by the upload route (no sync); the upload source has no connector. */
const uploadConnector: Connector = { provider: "upload", async sync() { return { docs: [], complete: false, warnings: ["Uploaded documents are managed by upload, not sync."] }; } };

const REGISTRY: Record<Provider, Connector> = {
  github: githubConnector,
  codeforces: codeforcesConnector,
  leetcode: leetcodeConnector,
  linkedin: manualConnector,
  notes: manualConnector,
  portfolio: portfolioConnector,
  gdocs: gdocsConnector,
  upload: uploadConnector,
};

export const getConnector = (p: Provider): Connector | null => REGISTRY[p] ?? null;

export const SUPPORTED_PROVIDERS: { provider: Provider; label: string; auth: "oauth" | "token" | "public" | "manual" | "upload"; description: string }[] = [
  { provider: "github", label: "GitHub", auth: "oauth", description: "READMEs, manifests, selected source files, your PRs/issues and commit messages. Public repos by username, or connect your account (optionally with private repos)." },
  { provider: "upload", label: "Documents", auth: "upload", description: "Upload resumes, reports and notes (PDF, DOCX, TXT, MD). Text is extracted and indexed." },
  { provider: "codeforces", label: "Codeforces", auth: "public", description: "Public handle: rating, contests and observed solved-problem patterns via the official API." },
  { provider: "leetcode", label: "LeetCode", auth: "manual", description: "Paste an export of solved problems, or add your public profile link. Nothing is scraped." },
  { provider: "linkedin", label: "LinkedIn", auth: "manual", description: "Paste your profile text. We never fetch LinkedIn pages." },
  { provider: "gdocs", label: "Google Docs", auth: "public", description: "Up to 10 Google Docs you share as \"Anyone with the link can view\" (resume, write-ups, notes). Read-only; no Google account access." },
  { provider: "portfolio", label: "Portfolio site", auth: "public", description: "Import one public web page you name." },
];
