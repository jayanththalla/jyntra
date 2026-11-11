// Atlas career workflows. POST { workflow: "resume_vs_jd" | "roadmap" | "bullets", jd?, project?, target_role? }; GET lists the projects bullets can be written for.
import { guard, json, err, readJson, str } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { listProjectNames, searchChunks } from "@/lib/kb/search";
import { buildBulletsPrompt, buildRoadmap, compareToJd, fallbackBullets, ownedSkills, parseBullets, type BulletSource } from "@/lib/kb/workflows";
import { completeText, configuredProviders } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function entitiesOf(userId: number) {
  return query<{ kind: string; name: string; level: string }>("SELECT kind, name, level FROM kb_entities WHERE user_id = $1 AND kind = 'skill'", [userId]).catch(() => []);
}

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const names = new Set<string>([...(g.user.profile.projects ?? []).map((p) => p.name), ...(await listProjectNames(g.user.id).catch(() => []))].filter(Boolean));
  return json({ projects: [...names].slice(0, 60), ai: configuredProviders(depsFromEnv()).length > 0 });
}

export async function POST(req: Request) {
  const g = await guard(req, "kbAsk");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, unknown>>(req, 60_000);
  if (!b) return err("invalid_request", 400);
  const workflow = str(b.workflow, 20);
  const profile = g.user.profile;

  if (workflow === "resume_vs_jd" || workflow === "roadmap") {
    const jd = str(b.jd, 12_000);
    if (jd.length < 40) return err("jd_too_short", 400, "Paste the job description (at least a few lines) first.");
    const owned = ownedSkills(profile, await entitiesOf(g.user.id));
    const comparison = compareToJd(jd, owned);
    if (workflow === "resume_vs_jd") return json({ workflow, comparison, basis: "Skills named in the job description, compared with your profile, projects and Atlas documents. Rule-based: no AI is used." });
    return json({ workflow, comparison, roadmap: buildRoadmap(comparison.missing, jd, profile.projects ?? []) });
  }

  if (workflow === "bullets") {
    const project = str(b.project, 120);
    if (!project) return err("project_required", 400, "Choose a project first.");
    const mine = (profile.projects ?? []).find((p) => p.name.toLowerCase() === project.toLowerCase());
    const hits = await searchChunks(g.user.id, project, { projects: [project], limit: 4 }).catch(() => []);
    if (!mine && !hits.length) return err("project_not_found", 404, "That project isn't on your profile or in your Atlas documents.");
    const source: BulletSource = { name: mine?.name ?? project, description: mine?.description, stack: mine?.stack, evidence: hits.map((h) => h.content.slice(0, 500)) };
    const target = str(b.target_role, 80) || null;
    const deps = depsFromEnv();
    let bullets: string[] = [];
    let method: "ai" | "template" = "template";
    if (configuredProviders(deps).length) {
      try {
        bullets = parseBullets((await completeText(buildBulletsPrompt(source, target), deps)).text, source);
        if (bullets.length) method = "ai";
      } catch (e) {
        console.error("[kb/workflows] bullets:", (e as Error).name);
      }
    }
    if (!bullets.length) bullets = fallbackBullets(source);
    if (!bullets.length) return err("not_enough_facts", 422, "There isn't enough written about this project yet. Add a description or sync its repository in Atlas.");
    return json({ workflow, project: source.name, bullets, method, grounded_in: hits.length ? hits.map((h) => ({ title: h.title, url: h.url })).slice(0, 4) : [], note: method === "ai" ? "Rephrased by an AI model from your own project facts. Numbers, links and technologies not in those facts are removed. Add real results yourself." : "Built from your project facts without AI. Add a measured result if you have one." });
  }
  return err("invalid_workflow", 400);
}
