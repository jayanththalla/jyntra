// Current visitor: GET profile, POST create (onboarding), PUT update, DELETE sign out of this device.
import { safeHttpUrl } from "@/lib/url";
import { NextResponse } from "next/server";
import { createUser, currentUser, endSession, sessionToken, updateUserProfile, USER_COOKIE, cookieOptions } from "@/lib/users";
import { GENERIC_PROFILE } from "@/lib/database";
import { generateQueries } from "@/lib/discovery/queries";
import { candidateSkillSet } from "@/lib/matching/skills";
import type { CandidateProfile } from "@/lib/types";
import { LOCATION_OPTIONS } from "@/lib/types";
import { STARTUP_TYPE_OPTIONS } from "@/lib/resume/parse";
import { rateLimit } from "@/lib/rate-limit";
import { applyGmailPassword, publicProfile } from "@/lib/secrets/gmail";

export const dynamic = "force-dynamic";

const strArr = (v: unknown, max = 80) =>
  Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, max) : [];

/** Accepts the onboarding form (or a full profile from the advanced editor) and returns a clean profile. */
function toProfile(body: any, base: CandidateProfile = GENERIC_PROFILE, userId: number | null = null): CandidateProfile | string {
  const roles = strArr(body.target_roles, 20);
  const skills = strArr(body.skills);
  const locations = strArr(body.preferred_locations, 12).filter((l) => (LOCATION_OPTIONS as readonly string[]).includes(l));
  if (!roles.length) return "Pick at least one target role.";
  if (!skills.length) return "Add at least one skill.";
  if (!locations.length) return "Pick at least one location.";
  const gmailUser = typeof body.gmail_user === "string" ? body.gmail_user.trim().slice(0, 100) : base.gmail_user;
  const pw = applyGmailPassword(base, userId, body.gmail_app_password, typeof body.gmail_user === "string" ? gmailUser : undefined);
  if (pw.error === "invalid_password") return "That doesn't look like a Google App Password (16 letters, spaces allowed).";
  if (pw.error === "not_configured") return "Saving a Gmail password is disabled: the server has no credential encryption key configured.";
  if (pw.error === "needs_account") return "Create your profile first, then add Gmail in Settings.";
  const years = Number(body.tech_experience_years);
  return {
    ...base,
    ...(typeof body.name === "string" ? { name: body.name.slice(0, 80) } : {}),
    target_roles: roles,
    skills,
    programming_languages: strArr(body.programming_languages ?? []),
    frameworks: strArr(body.frameworks ?? []),
    libraries: strArr(body.libraries ?? []),
    databases: strArr(body.databases ?? []),
    cloud_tools: strArr(body.cloud_tools ?? []),
    testing_skills: strArr(body.testing_skills ?? []),
    ai_ml_skills: strArr(body.ai_ml_skills ?? []),
    tech_experience_years: Number.isFinite(years) ? Math.max(0, Math.min(40, years)) : 0,
    preferred_locations: locations,
    remote_preference: locations.some((l) => l.startsWith("Remote")) ? "remote_ok" : "onsite",
    preferred_startup_types: strArr(body.preferred_startup_types, 12).filter((t) => STARTUP_TYPE_OPTIONS.includes(t)),
    // Candidate Social & Knowledge Hub
    github_url: typeof body.github_url === "string" ? safeHttpUrl(body.github_url.slice(0, 200), { assumeHttps: true }) ?? "" : base.github_url, // http(s) only; anything else is dropped
    github_username: typeof body.github_username === "string" ? body.github_username.trim().slice(0, 100) : base.github_username,
    linkedin_url: typeof body.linkedin_url === "string" ? safeHttpUrl(body.linkedin_url.slice(0, 200), { assumeHttps: true }) ?? "" : base.linkedin_url, // http(s) only; anything else is dropped
    medium_url: typeof body.medium_url === "string" ? safeHttpUrl(body.medium_url.slice(0, 200), { assumeHttps: true }) ?? "" : base.medium_url, // http(s) only; anything else is dropped
    portfolio_url: typeof body.portfolio_url === "string" ? safeHttpUrl(body.portfolio_url.slice(0, 200), { assumeHttps: true }) ?? "" : base.portfolio_url, // http(s) only; anything else is dropped
    twitter_url: typeof body.twitter_url === "string" ? safeHttpUrl(body.twitter_url.slice(0, 200), { assumeHttps: true }) ?? "" : base.twitter_url, // http(s) only; anything else is dropped
    bio: typeof body.bio === "string" ? body.bio.trim().slice(0, 2000) : base.bio,
    personal_email: typeof body.personal_email === "string" ? body.personal_email.trim().slice(0, 100) : base.personal_email,
    gmail_user: gmailUser,
    // Password: encrypted (AES-256-GCM) before it reaches the database; a blank value keeps the saved one;
    // clearing the Gmail address clears both. Legacy plaintext is dropped on every save.
    gmail_app_password: undefined,
    gmail_app_password_enc: pw.enc,
    explorer: false, // saving real skills ends "explore" mode
  };
}

/** "Skip for now": a profile with general software roles and no skills, for browsing funded startups. */
const EXPLORER_PROFILE: CandidateProfile = { ...GENERIC_PROFILE, explorer: true };

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ user: null }, { status: 401 });
    // No tokens here: page scripts never see the session token; the private link is only handed out by POST /api/me/link.
    return NextResponse.json({
      // The Gmail app password never leaves the server; the browser only learns whether one is saved.
      user: { id: user.id, profile: publicProfile(user.profile), linkCreatedAt: user.link_created_at, memberSince: user.created_at ? new Date(user.created_at).toISOString() : null, email: user.email, googleLinked: user.google_linked },
      queries: generateQueries(user.profile),
      canonicalSkills: [...candidateSkillSet(user.profile)].sort(),
    });
  } catch (e: any) {
    console.error("[api/me]", e?.message); // server log only; the browser gets a generic message
    return NextResponse.json({ error: "Failed to load profile." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const existing = await currentUser();
    if (body.explore === true) {
      if (existing) return NextResponse.json({ ok: true, existing: true }); // never overwrite a real profile
      const limited = rateLimit(req, "createProfile");
      if (limited) return limited;
      const { sessionToken } = await createUser(EXPLORER_PROFILE);
      const res = NextResponse.json({ ok: true, created: true });
      res.cookies.set(USER_COOKIE, sessionToken, cookieOptions);
      return res;
    }
    const profile = toProfile(body, existing?.profile ?? GENERIC_PROFILE, existing?.id ?? null); // keep saved fields (e.g. Gmail) on re-save
    if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
    const limited = rateLimit(req, existing ? "updateProfile" : "createProfile");
    if (limited) return limited;
    if (existing) {
      await updateUserProfile(existing.id, profile);
      return NextResponse.json({ ok: true, updated: true });
    }
    const { sessionToken } = await createUser(profile);
    const res = NextResponse.json({ ok: true, created: true });
    res.cookies.set(USER_COOKIE, sessionToken, cookieOptions);
    return res;
  } catch (e: any) {
    console.error("[api/me]", e?.message); // server log only; the browser gets a generic message
    return NextResponse.json({ error: "Failed to save profile." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "No profile yet." }, { status: 401 });
    const limited = rateLimit(req, "updateProfile");
    if (limited) return limited;
    const profile = toProfile(await req.json(), user.profile, user.id);
    if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
    await updateUserProfile(user.id, profile);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[api/me]", e?.message); // server log only; the browser gets a generic message
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }
}

/** Sign out on this device: the session is deleted on the server, not just the cookie. */
export async function DELETE() {
  await endSession(await sessionToken());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
