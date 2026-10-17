import { useState, type ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { AlertTriangle, Check, Copy, Info, OctagonAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "../../i18n";
import { Tooltip } from "./Tooltip";

/**
 * Meter is a thin progress track in the accent; with no `value` it shows
 * work of unknown length as a sweeping band. A `live` meter (still
 * filling) carries a light running along its fill.
 *
 * The fill is full width and slides in from the left by transform, which
 * the compositor animates on its own; transitioning `width` instead re-lays
 * out the page on every frame.
 */
export function Meter({
  value,
  live,
  thick,
  className = "",
  label,
}: {
  value?: number;
  live?: boolean;
  thick?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`relative ${thick ? "h-1.5" : "h-1"} overflow-hidden rounded-full bg-muted ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
    >
      {value === undefined ? (
        <div className="indeterminate absolute inset-y-0 w-2/5 rounded-full bg-brand-mark" />
      ) : (
        <Fill value={value} className="overflow-hidden bg-gradient-to-r from-brand-fill to-brand-mark">
          {live && <div className="shimmer absolute inset-0" />}
        </Fill>
      )}
    </div>
  );
}

/**
 * Fill is a bar's filled part, 0..1 of its track (which must clip), moved
 * by transform so updates animate on the compositor.
 */
export function Fill({
  value,
  className = "",
  style,
  children,
}: {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`absolute inset-0 rounded-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${className}`}
      style={{ transform: `translateX(${(v - 1) * 100}%)`, ...style }}
    >
      {children}
    </div>
  );
}

const NOTICE = {
  info: { icon: Info },
  warn: { icon: AlertTriangle },
  critical: { icon: OctagonAlert },
} as const;

/** The ink each tone's symbol is drawn in. */
const INK: Record<keyof typeof NOTICE, string> = {
  info: "text-info-ink",
  warn: "text-warn-ink",
  critical: "text-critical-ink",
};

/**
 * Notice is an inline message: an error, a warning, or a note worth reading
 * first. As a Mac's "Finish setting up" row in System Settings: plain
 * glass with no wash of colour, the tone carried by its symbol alone, a
 * title over a muted line, and its action (a button) at the end, under the
 * text where the row is narrow.
 */
export function Notice({
  tone,
  title,
  children,
  action,
  className = "",
}: {
  tone: keyof typeof NOTICE;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = NOTICE[tone].icon;
  return (
    <div
      className={`glass @container flex flex-col gap-3 px-4 py-3.5 ${className}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:gap-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* Centred on the first line, whatever its height: a nudge would be right for one line height only */}
          <span className="flex h-[1lh] shrink-0 items-center">
            <Icon className={`size-5 ${INK[tone]}`} strokeWidth={1.75} />
          </span>
          <div className="selectable flex min-w-0 flex-col gap-0.5">
            {title && <span className="font-medium">{title}</span>}
            {children && (
              <div className={`break-words ${title ? "text-sm text-muted-foreground" : "text-foreground/90"}`}>
                {children}
              </div>
            )}
          </div>
        </div>
        {action && <div className="shrink-0 self-end @md:self-center">{action}</div>}
      </div>
    </div>
  );
}

/**
 * CopyButton copies a value, its icon turning to a check for a moment: an
 * inline icon, or with `label` a push button, `flat` on glass. `variants`
 * lets it arrive as part of a stagger.
 */
export function CopyButton({
  value,
  label,
  flat,
  className = "",
  variants,
}: {
  value: string;
  label?: boolean;
  flat?: boolean;
  className?: string;
  variants?: Variants;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const button = (
    <motion.button
      type="button"
      variants={variants}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied: the value stays selectable */
        }
      }}
      className={`btn ${label ? (flat ? "btn-flat" : "btn-secondary") : "btn-ghost btn-sm btn-icon"} ${className}`}
      aria-label={copied ? t("common.copied") : t("common.copy")}
    >
      {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      {label && (copied ? t("common.copied") : t("common.copy"))}
    </motion.button>
  );
  return label ? button : <Tooltip content={copied ? t("common.copied") : t("common.copy")}>{button}</Tooltip>;
}

/**
 * EmptySymbol leads an empty state, as Apple's do: a large bare symbol in
 * the muted colour over the words, no disc behind it (a disc is for a
 * control, an item's avatar, or a filled status mark). `className` sets
 * another size and colour for a hero, in place of the muted one.
 *
 * Faded by opacity, never by a translucent colour: an SVG paints each of
 * its lines on its own, so where a translucent colour's lines meet or
 * cross they'd overlap darker, while opacity fades the drawn symbol whole.
 */
export function EmptySymbol({
  icon: Icon,
  className = "size-10 text-muted-foreground opacity-70",
}: {
  icon: LucideIcon;
  className?: string;
}) {
  // Lighter than the app's 1.75, as the symbol is twice the size: about 2px drawn, not 3
  return <Icon className={`shrink-0 ${className}`} strokeWidth={1.25} aria-hidden />;
}
