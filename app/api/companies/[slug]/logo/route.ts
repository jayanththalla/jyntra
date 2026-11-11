import { NextResponse } from "next/server";
import { loadArena } from "@/lib/arena";
import { query } from "@/lib/database";
import { trustedWebsiteFor, upsertCompanyProfile } from "@/lib/company-jobs/store";
import { readLogoCache, resolveCompanyLogo, writeLogoCache } from "@/lib/logos/resolve";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) return new NextResponse(null, { status: 404 });
  const cached = readLogoCache(slug);
  if (cached) {
    return new NextResponse(new Uint8Array(cached.bytes), { headers: { "Content-Type": cached.contentType, "Cache-Control": "public, max-age=86400" } });
  }
  const fileCo = loadArena().bySlug.get(slug);
  const name = fileCo?.name ?? slug;
  try {
    await upsertCompanyProfile(slug, name);
    const [row] = await query<{ logo_url: string | null; logo_status: string | null; logo_checked_at: string | null; website: string | null }>(
      "SELECT logo_url, logo_status, logo_checked_at, website FROM company_profiles WHERE slug=$1",
      [slug]
    );
    const fresh = row?.logo_checked_at && Date.now() - Date.parse(row.logo_checked_at) < 7 * 86400_000;
    if (fresh && (row.logo_status === "initials" || row.logo_status === "failed")) return new NextResponse(null, { status: 404 });
    const website = row?.website ?? (await trustedWebsiteFor(slug, name));
    if (!website) {
      await query("UPDATE company_profiles SET logo_status='initials', logo_checked_at=now() WHERE slug=$1", [slug]);
      return new NextResponse(null, { status: 404 });
    }
    const logo = await resolveCompanyLogo(website);
    await query(
      `UPDATE company_profiles SET logo_url=$2, logo_source_domain=$3, logo_status=$4, logo_checked_at=now(), website=COALESCE(website,$5) WHERE slug=$1`,
      [slug, logo.url, logo.sourceDomain, logo.status, website]
    );
    if (logo.status !== "resolved" || !logo.bytes || !logo.contentType) return new NextResponse(null, { status: 404 });
    writeLogoCache(slug, logo.contentType, logo.bytes);
    return new NextResponse(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.contentType, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
