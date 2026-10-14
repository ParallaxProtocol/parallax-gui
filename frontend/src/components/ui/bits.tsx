import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Info, OctagonAlert } from "lucide-react";
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
  info: { icon: Info, box: "border-info/30 bg-info/[0.08]", ink: "text-info-ink" },
  warn: { icon: AlertTriangle, box: "border-warn/35 bg-warn/[0.09]", ink: "text-warn-ink" },
  critical: { icon: OctagonAlert, box: "border-critical/35 bg-critical/[0.08]", ink: "text-critical-ink" },
} as const;

/** Notice is an inline message bar: an error, a warning, or a note worth reading first. */
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
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${n.box} ${className}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      <Icon className={`mt-px size-4 shrink-0 ${n.ink}`} />
      <div className="selectable min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="break-words text-foreground/85">{children}</div>}
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
