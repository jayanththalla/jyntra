import { NextResponse } from "next/server";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { loadStartups } from "@/lib/discovery/read";

export const dynamic = "force-dynamic";

/** GET — one startup (with jobs, emails, applications) for the signed-in user. Used by the outreach page. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  try {
    const [startup] = await loadStartups(user, { id });
    if (!startup) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ startup });
  } catch (e) {
    console.error("[api/startups]", (e as Error).message); // server log only
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/** PATCH { show_again: boolean } — pin/unpin a startup for the current user. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (typeof body.show_again !== "boolean") return NextResponse.json({ error: "show_again must be boolean" }, { status: 400 });
  await query(
    body.show_again
      ? "UPDATE users SET pinned = array_append(array_remove(pinned, $2), $2) WHERE id = $1"
      : "UPDATE users SET pinned = array_remove(pinned, $2) WHERE id = $1",
    [user.id, Number(id)]
  );
  return NextResponse.json({ ok: true });
}
