import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { TONE_WASH, type Tone } from "./tone";

/**
 * Pill is a small capsule label beside a name or a value: a state, a kind,
 * a count. It takes a ref and handlers, so a Tooltip can wrap it.
 */
export const Pill = forwardRef<
  HTMLSpanElement,
  { tone?: Tone; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">
>(function Pill({ tone = "neutral", className = "", children, ...rest }, ref) {
  return (
    <span ref={ref} className={`badge ${tone === "neutral" ? "" : TONE_WASH[tone]} ${className}`} {...rest}>
      {children}
    </span>
  );
});
