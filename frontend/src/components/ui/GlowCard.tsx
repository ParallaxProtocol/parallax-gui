import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

/**
 * GlowCard is the app's hero surface: a large card of frosted glass lit by
 * a soft glow from a top corner (the right, or the left), the brand's
 * violet, or amber when what it shows needs attention.
 */
export function GlowCard({
  tone,
  glowAt = "right",
  className = "",
  children,
  ...rest
}: { tone?: "warn" | null; glowAt?: "left" | "right"; className?: string; children: ReactNode } & Omit<
  HTMLMotionProps<"section">,
  "children" | "className"
>) {
  const glow =
    tone === "warn"
      ? "radial-gradient(closest-side, color-mix(in oklab, var(--warn) 20%, transparent), transparent)"
      : "radial-gradient(closest-side, color-mix(in oklab, var(--app-brand-mark) 22%, transparent), color-mix(in oklab, #5b5bf0 8%, transparent) 55%, transparent)";
  return (
    <motion.section
      className={`glass relative overflow-hidden p-6 ${className}`}
      style={{ borderRadius: 24 }}
      {...rest}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -top-48 size-[34rem] ${glowAt === "left" ? "-left-32" : "-right-32"}`}
        style={{ background: glow }}
      />
      <div className="relative">{children}</div>
    </motion.section>
  );
}
