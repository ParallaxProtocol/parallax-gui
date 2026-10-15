import type { LucideIcon } from "lucide-react";

/**
 * The colours a tile takes, as Apple's apps give their places: the
 * sidebar's destinations and Settings' sections.
 */
export const TILE = {
  gray: "#8e8e93",
  graphite: "#636366",
  blue: "#0a84ff",
  indigo: "#5e5ce6",
  purple: "#8b5cf6",
  green: "#30b158",
  orange: "#ff9f0a",
  pink: "#ff375f",
  red: "#ff453a",
} as const;

/**
 * IconTile is an icon on a coloured, softly lit rounded square, as in
 * System Settings' list: the mark of a place in the app. Small beside a
 * name in a list, large as a page's header.
 */
export function IconTile({
  icon: Icon,
  color,
  large,
  className = "",
}: {
  icon: LucideIcon;
  color: string;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/25%),0_1px_2px_rgb(0_0_0/25%)] ${
        large ? "size-12 rounded-[14px]" : "size-7 rounded-[8px]"
      } ${className}`}
      style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${color}, white 18%), ${color})` }}
    >
      <Icon className={large ? "size-6" : "size-4"} strokeWidth={2} />
    </span>
  );
}
