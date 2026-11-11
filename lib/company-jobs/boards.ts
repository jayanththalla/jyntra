// City-scoped company job boards. Each entry points at a company's PUBLIC ATS job-board API
// (Greenhouse, Lever or Ashby) — the same feeds those companies publish for their own careers pages.
import fs from "node:fs";
import path from "node:path";
import type { AtsRef } from "@/sources/jobs/ats";

export interface BoardEntry {
  name: string;
  ats: AtsRef["vendor"];
  slug: string;
  city: string; // key of CITIES
  website?: string | null;
}

export interface City { id: string; label: string; match: string[] }

export const CITIES: Record<string, City> = {
  hyderabad: { id: "hyderabad", label: "Hyderabad", match: ["hyderabad", "secunderabad", "gachibowli", "hitec city", "hi-tec city", "hitech city", "madhapur", "kondapur", "telangana"] },
  bengaluru: { id: "bengaluru", label: "Bengaluru", match: ["bengaluru", "bangalore", "bengalooru"] },
  pune: { id: "pune", label: "Pune", match: ["pune"] },
  chennai: { id: "chennai", label: "Chennai", match: ["chennai"] },
  mumbai: { id: "mumbai", label: "Mumbai", match: ["mumbai", "navi mumbai", "thane"] },
  delhi: { id: "delhi", label: "Delhi NCR", match: ["delhi", "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad"] },
};

const VENDORS = new Set(["greenhouse", "lever", "ashby"]);
const BOARD_SLUG = /^[a-z0-9][a-z0-9_.%-]{0,80}$/i;

export const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Directory slug for a board's company. Board companies get their own slug space (never the snapshot's). */
export const companySlugFor = (b: Pick<BoardEntry, "name">) => slugify(b.name);

export function matchesCity(location: string | null | undefined, cityId: string): boolean {
  const city = CITIES[cityId];
  if (!city || !location) return false;
  const l = location.toLowerCase();
  return city.match.some((m) => l.includes(m));
}

export function parseBoards(raw: unknown): BoardEntry[] {
  const list = (raw as { boards?: unknown })?.boards;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: BoardEntry[] = [];
  for (const b of list) {
    if (!b || typeof b !== "object") continue;
    const e = b as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const ats = String(e.ats ?? "").toLowerCase();
    const slug = typeof e.slug === "string" ? e.slug.trim() : "";
    const city = String(e.city ?? "").toLowerCase();
    if (!name || !VENDORS.has(ats) || !BOARD_SLUG.test(slug) || !CITIES[city]) continue;
    const key = `${ats}/${slug}/${city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, ats: ats as BoardEntry["ats"], slug, city, website: typeof e.website === "string" ? e.website : null });
  }
  return out;
}

export function loadBoards(file = path.join(process.cwd(), "data", "boards.json")): BoardEntry[] {
  try {
    return parseBoards(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}
