// Private link.
// POST /api/me/link       → new link token for the signed-in user (the previous link stops working).
// GET  /api/me/link?t=…   → opens the profile on this device: starts a new session and sets its cookie.
import { NextResponse } from "next/server";
import { createSession, currentUser, newLinkToken, userByLinkToken, USER_COOKIE, cookieOptions } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Relative redirect. Behind Render's proxy, req.url is the internal address (https://localhost:10000),
 * so an absolute URL built from it sends people to localhost. Browsers resolve a relative Location
 * against the address they actually opened.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path, "Referrer-Policy": "no-referrer" } });
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "privateLink");
  if (limited) return limited;
  const user = await userByLinkToken(new URL(req.url).searchParams.get("t"));
  if (!user) return redirectTo("/onboarding?link=invalid");
  const res = redirectTo("/dashboard");
  res.cookies.set(USER_COOKIE, await createSession(user.id), cookieOptions);
  return res;
}

/** Returns only the token; the page builds the URL from its own address (see the redirect note above). */
export async function POST(req: Request) {
  const limited = rateLimit(req, "newLink");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const token = await newLinkToken(user.id);
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
