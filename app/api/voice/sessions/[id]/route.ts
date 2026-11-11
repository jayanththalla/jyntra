import { json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { deleteSession, getSession } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

export const GET = (req: Request, c: { params: Promise<{ id: string }> }) => withUser(req, "read", async (user) => json(await getSession(user, sessionId(await c.params), voiceDeps())));
/** DELETE removes the session, its turns, its evaluation and every stored recording. */
export const DELETE = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "write", async (user) => {
    await deleteSession(user.id, sessionId(await c.params));
    return json({ ok: true });
  });
