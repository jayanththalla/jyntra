import { guard, json } from "@/lib/kb/api";
import { listResumes } from "@/lib/career/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  return json({ resumes: await listResumes(g.user.id) });
}
