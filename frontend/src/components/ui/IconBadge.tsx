import { forwardRef, type HTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { TONE_WASH, type Tone } from "./tone";

const SIZE = {
  xs: { box: "size-5", icon: "size-3" },
  sm: { box: "size-8", icon: "size-4" },
  md: { box: "size-10", icon: "size-[18px]" },
  lg: { box: "size-12", icon: "size-5" },
} as const;

/**
 * IconBadge is an icon in a round, tinted badge: what leads a row, a
 * notice or a card. The one place these circles are drawn, so they stay
 * alike across the app. It takes a ref and handlers, so a Tooltip can wrap it.
 */
export const IconBadge = forwardRef<
  HTMLSpanElement,
  { icon: LucideIcon; tone?: Tone; size?: keyof typeof SIZE; className?: string } & Omit<
    HTMLAttributes<HTMLSpanElement>,
    "className"
  >
>(function IconBadge({ icon: Icon, tone = "neutral", size = "md", className = "", ...rest }, ref) {
  const s = SIZE[size];
  return (
    <span
      ref={ref}
      className={`grid shrink-0 place-items-center rounded-full ${s.box} ${TONE_WASH[tone]} ${className}`}
      {...rest}
    >
      <Icon className={s.icon} />
    </span>
  );
});
