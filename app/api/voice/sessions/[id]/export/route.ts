import { NextResponse } from "next/server";
import { sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { exportSession } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

/** GET ?format=md|json → a downloadable transcript (and evaluation, when there is one). */
export const GET = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "read", async (user) => {
    const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
    const r = await exportSession(user, sessionId(await c.params), format, voiceDeps());
    return new NextResponse(r.body, { headers: { "Content-Type": `${r.mime}; charset=utf-8`, "Content-Disposition": `attachment; filename="${r.filename}"`, "Cache-Control": "no-store" } });
  });
