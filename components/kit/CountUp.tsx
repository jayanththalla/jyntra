"use client";
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/** Counts a whole number up from 0 once on mount. Shows the final value immediately with reduced motion, and in server HTML (no flash of 0). */
export function CountUp({ to, duration = 0.8 }: { to: number; duration?: number }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(to);
  const first = useRef(true);
  useEffect(() => {
    if (reduce || !Number.isFinite(to)) { setV(to); return; }
    const from = first.current ? 0 : v;
    first.current = false;
    const c = animate(from, to, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduce, duration]);
  return <span className="tabular-nums">{v}</span>;
}

/** A horizontal bar that grows to `pct` (0-100). */
export function GrowBar({ pct, className }: { pct: number; className?: string }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(reduce ? pct : 0);
  useEffect(() => { const t = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, pct)))); return () => cancelAnimationFrame(t); }, [pct]);
  return <div className="h-2 w-full overflow-hidden rounded-full bg-secondary"><div className={className ?? "h-full rounded-full bg-indigo"} style={{ width: `${w}%`, transition: reduce ? "none" : "width .8s cubic-bezier(.22,1,.36,1)" }} /></div>;
}
