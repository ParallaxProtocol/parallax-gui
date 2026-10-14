import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Info, OctagonAlert } from "lucide-react";
import { useT } from "../../i18n";
import { Tooltip } from "./Tooltip";
import { IconBadge } from "./IconBadge";

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

const tint = (tone: keyof typeof NOTICE) => `color-mix(in oklab, var(--${tone}) 7%, transparent)`;

/**
 * Notice is an inline message: an error, a warning, or a note worth reading
 * first. A card of frosted glass, faintly tinted by its tone, with the
 * tone's icon in a round badge.
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
  const n = NOTICE[tone];
  const Icon = n.icon;
  return (
    <div
      className={`glass flex items-center gap-3.5 px-4 py-3.5 ${className}`}
      // The tint lies over the glass, whose own colour it can't replace
      style={{ backgroundImage: `linear-gradient(${tint(tone)}, ${tint(tone)})` }}
      role={tone === "critical" ? "alert" : "status"}
    >
      <IconBadge icon={Icon} tone={tone} className="self-start" />
      <div className="selectable flex min-w-0 flex-1 flex-col gap-0.5 self-center">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={`break-words ${title ? "text-muted-foreground" : "text-foreground/90"}`}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** CopyButton copies a value, its icon turning to a check for a moment: an inline icon, or with `label` a push button. */
export function CopyButton({ value, label, className = "" }: { value: string; label?: boolean; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const button = (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard denied: the value stays selectable */
        }
      }}
      className={`btn ${label ? "btn-secondary" : "btn-ghost btn-sm btn-icon"} ${className}`}
      aria-label={copied ? t("common.copied") : t("common.copy")}
    >
      {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      {label && (copied ? t("common.copied") : t("common.copy"))}
    </button>
  );
  return label ? button : <Tooltip content={copied ? t("common.copied") : t("common.copy")}>{button}</Tooltip>;
}
