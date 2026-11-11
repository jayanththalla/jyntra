"use client";
// Fades and lifts its children into view the first time they scroll on screen. Content is visible without JavaScript, and
// anything already on screen at load is left alone (no flash). prefers-reduced-motion turns the effect off (see globals.css).
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "hidden" | "in">("visible");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // already in view: stay visible, play bar animations only
    setState("hidden");
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setState("in"); io.disconnect(); } }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} data-reveal={state} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
