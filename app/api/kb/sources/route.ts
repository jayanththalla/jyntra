// GET: the candidate's sources + status. POST: connect a source (verified before it shows as connected).
import { guard, json, err, readJson, str } from "@/lib/kb/api";
import { createSource, listSources, publicSource } from "@/lib/kb/store";
import { syncInBackground, syncSource } from "@/lib/kb/sync";
import { SUPPORTED_PROVIDERS } from "@/lib/kb/connectors";
import { verifyToken } from "@/lib/kb/connectors/github";
import { encryptionConfigured, encryptSecret } from "@/lib/kb/crypto";
import { parseDocLinks } from "@/lib/kb/connectors/gdocs";
import { SourceError, type Provider } from "@/lib/kb/types";

export const dynamic = "force-dynamic";
const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const CF_HANDLE = /^[A-Za-z0-9_.-]{2,24}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sources = (await listSources(g.user.id)).map(publicSource);
  return json({
    sources,
    providers: SUPPORTED_PROVIDERS,
    capabilities: {
      github_oauth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) && encryptionConfigured(),
      github_token: encryptionConfigured(),
      ai: !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY),
    },
  });
}

export async function POST(req: Request) {
  const g = await guard(req, "kbSync");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 400_000);
  if (!b) return err("invalid_request", 400);
  const provider = str(b.provider, 20) as Provider;
  const userId = g.user.id;
  try {
    let config: Record<string, unknown> = {};
    let label = "";
    let credentialsEnc: string | null = null;
    let inline = false;
    switch (provider) {
      case "github": {
        const login = str(b.login, 39);
        const token = str(b.token, 300);
        const repos = Array.isArray(b.repos) ? b.repos.map((r: unknown) => str(r, 201)).filter((r: string) => REPO.test(r)).slice(0, 30) : [];
        if (!token && !GH_LOGIN.test(login)) return err("invalid_login", 400, "Enter a GitHub username, or a personal access token.");
        let resolvedLogin = login;
        if (token) {
          if (!encryptionConfigured()) return err("not_configured", 503, "Token storage isn't configured on this server (KB_ENCRYPTION_KEY).");
          const v = await verifyToken(token); // verified BEFORE anything is stored or shown as connected
          resolvedLogin = v.login;
          credentialsEnc = encryptSecret(token);
        }
        config = { login: resolvedLogin, repos, includePrivate: !!token && b.includePrivate === true };
        label = `GitHub: ${resolvedLogin}`;
        break;
      }
      case "codeforces":
        if (!CF_HANDLE.test(str(b.handle, 24))) return err("invalid_handle", 400, "Enter your Codeforces handle.");
        config = { handle: str(b.handle, 24) };
        label = `Codeforces: ${config.handle}`;
        break;
      case "leetcode":
        if (!str(b.importText, 200_000) && !str(b.profileUrl, 200)) return err("invalid_request", 400, "Paste an export of your solved problems, or give your public profile URL.");
        config = { importText: str(b.importText, 200_000), profileUrl: str(b.profileUrl, 200) };
        label = "LeetCode";
        inline = true;
        break;
      case "linkedin":
      case "notes":
        if (str(b.text, 100_000).length < 20) return err("invalid_request", 400, "Paste the text to import (at least a few lines).");
        config = { text: str(b.text, 100_000), profileUrl: str(b.profileUrl, 200), kind: provider };
        label = provider === "linkedin" ? "LinkedIn (pasted)" : str(b.title, 80) || "Notes";
        inline = true;
        break;
      case "gdocs": {
        const { ids, bad } = parseDocLinks(str(b.links, 3000));
        if (!ids.length) return err("invalid_url", 400, "Paste at least one Google Docs link (https://docs.google.com/document/d/…).");
        if (bad.length) return err("invalid_url", 400, `These aren't Google Docs links: ${bad.slice(0, 3).join(", ")}`);
        config = { docIds: ids };
        label = `Google Docs (${ids.length})`;
        break;
      }
      case "portfolio":
        if (!/^https?:\/\//i.test(str(b.url, 300))) return err("invalid_url", 400, "Enter your portfolio URL (https://…).");
        config = { url: str(b.url, 300) };
        label = `Portfolio: ${new URL(str(b.url, 300)).hostname}`;
        break;
      default:
        return err("unsupported_provider", 400, "That source isn't supported yet.");
    }
    const src = await createSource(userId, { provider, label, config, credentialsEnc });
    if (inline) {
      const r = await syncSource(userId, src.id);
      return json({ source: { id: src.id, provider, label }, sync: r }, r.ok ? 201 : 422);
    }
    syncInBackground(userId, src.id);
    return json({ source: { id: src.id, provider, label, status: "pending" } }, 202);
  } catch (e) {
    if (e instanceof SourceError) return err(e.code, e.code === "unauthorized" ? 401 : 422, e.code === "unauthorized" ? "GitHub rejected that token." : "Couldn't verify that source.");
    console.error("[api/kb/sources]", (e as Error).message.slice(0, 120));
    return err("server_error", 500, "Couldn't connect that source. Please try again.");
  }
}
