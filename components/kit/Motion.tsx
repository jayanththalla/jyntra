"use client";
// Small, purposeful entrance motion. Respects prefers-reduced-motion through <MotionConfig reducedMotion="user"> in AppShell.
import { motion, type HTMLMotionProps } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Stagger({ children, className, delay = 0, gap = 0.05, ...rest }: { delay?: number; gap?: number } & HTMLMotionProps<"div">) {
  return (
    <motion.div initial="hidden" animate="show" className={className} variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }} {...rest}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } }} {...rest}>
      {children}
    </motion.div>
  );
}

/** Fade/slide in once on mount. */
export function FadeIn({ children, className, delay = 0, ...rest }: { delay?: number } & HTMLMotionProps<"div">) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE, delay }} {...rest}>
      {children}
    </motion.div>
  );
}
