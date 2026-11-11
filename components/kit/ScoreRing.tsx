import { cn } from "@/lib/utils";

/** Circular score (0-100). Decorative ring plus a real number, so it reads without colour. */
export function ScoreRing({ value, size = 112, label = "/100", onDark = false, className }: { value: number | null; size?: number; label?: string; onDark?: boolean; className?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 44, c = 2 * Math.PI * r;
  const tone = onDark ? "text-[var(--sun)]" : v >= 75 ? "text-success" : v >= 50 ? "text-primary" : "text-warning";
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} role="img" aria-label={value == null ? "No score" : `Score ${Math.round(v)} out of 100`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className={onDark ? "stroke-white/25" : "stroke-border"} />
        {value != null && <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className={cn("stroke-current transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none", tone)} />}
      </svg>
      <div className="text-center leading-none">
        <span className={cn("display text-3xl tabular-nums", onDark && "text-white")}>{value == null ? "–" : Math.round(v)}</span>
        {value != null && <span className={cn("mt-0.5 block text-[10px] font-medium", onDark ? "text-white/70" : "text-muted-foreground")}>{label}</span>}
      </div>
    </div>
  );
}
