import { NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { listMessages } from "@/lib/outreach/service";

export const dynamic = "force-dynamic";

const int = (v: string | null) => (v !== null && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : v === null ? undefined : NaN);

/** READ-ONLY legacy history (messages recorded before drafts and sending moved to /api/comms). New drafts, sends and logs all use /api/comms.
 *  GET /api/outreach/messages?startup_id=&job_id=&status=draft|sent&application_id= : the signed-in user's own messages. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const startupId = int(sp.get("startup_id"));
  const applicationId = int(sp.get("application_id"));
  const jobRaw = sp.get("job_id");
  const jobId = jobRaw === null ? undefined : jobRaw === "0" || jobRaw === "" ? null : int(jobRaw);
  const status = sp.get("status");
  if (Number.isNaN(startupId) || Number.isNaN(applicationId) || (typeof jobId === "number" && Number.isNaN(jobId)) || (status !== null && status !== "draft" && status !== "sent"))
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  try {
    const r = await listMessages(user, { startupId, applicationId, jobId, status: (status as "draft" | "sent" | null) ?? undefined });
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[api/outreach/messages]", (e as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
