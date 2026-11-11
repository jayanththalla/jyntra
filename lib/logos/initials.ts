export function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase();
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}
