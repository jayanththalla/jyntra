import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { googleLoginConfigured, safeNext } from "@/lib/auth/google";
import { currentUser } from "@/lib/users";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled. Nothing changed.",
  state: "That sign-in expired or didn't match. Please try again.",
  exchange_failed: "Google didn't confirm the sign-in. Please try again.",
  bad_token: "The sign-in couldn't be verified. Please try again.",
  unverified_email: "That Google account's email isn't verified, so it can't be used to sign in.",
  not_configured: "Google sign-in isn't set up on this server yet.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  failed: "Sign-in failed. Please try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const user = await currentUser().catch(() => null);
  if (user && !sp.error) redirect(next);
  const configured = googleLoginConfigured();
  const error = sp.error ? ERRORS[sp.error] ?? ERRORS.failed : null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="hero-zone relative overflow-hidden rounded-3xl px-6 pb-8 pt-7">
        <img src="/illustrations/3d/rocket.png" alt="" width={160} height={160} className="pointer-events-none absolute -right-3 top-3 w-36 opacity-95" />
        <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Jyntra</p>
        <h1 className="mt-2 max-w-[10ch] text-3xl font-semibold leading-tight tracking-tight">Sign in to Jyntra</h1>
        <p className="mt-2 max-w-[28ch] text-sm text-white/85">Get your profile, applications and Atlas data back on any device.</p>
      </div>
      {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}</p>}
      {configured ? (
        <Button asChild size="lg" className="h-12"><a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>Continue with Google</a></Button>
      ) : (
        <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Google sign-in isn&apos;t configured on this server (needs <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and an encryption key). You can still use Jyntra without an account.</p>
      )}
      <p className="text-xs text-muted-foreground">Signing in only shares your name and verified email with Jyntra. It does not give Jyntra access to your Gmail. Sending email from Atlas is a separate, optional connection.</p>
      <Button asChild variant="ghost" className="h-11"><Link href="/onboarding">Continue without an account</Link></Button>
    </main>
  );
}
