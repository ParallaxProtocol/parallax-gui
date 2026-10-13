import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Info, OctagonAlert } from "lucide-react";
import { SPRING } from "../../lib/motion";
import { useT } from "../../i18n";

/**
 * Meter is a thin progress track. The fill takes the logo gradient; with
 * `active` it carries a moving sheen, and with no `value` it shows work of
 * unknown length as a sweeping band.
 */
export function Meter({
  value,
  active,
  className = "",
  label,
}: {
  /** 0..1, or undefined for indeterminate */
  value?: number;
  active?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`relative h-1.5 overflow-hidden rounded-full bg-muted ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
    >
      {value === undefined ? (
        <div className="brand-gradient-mark indeterminate absolute inset-y-0 w-2/5 rounded-full" />
      ) : (
        <div
          className={`brand-gradient-mark h-full rounded-full transition-[width] duration-700 ease-out ${
            active ? "sheen" : ""
          }`}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      )}
    </div>
  );
}

const NOTICE = {
  info: { icon: Info, box: "border-info/40 bg-info/[0.07]", ink: "text-info-ink" },
  warn: { icon: AlertTriangle, box: "border-warn/45 bg-warn/[0.08]", ink: "text-warn-ink" },
  critical: { icon: OctagonAlert, box: "border-critical/45 bg-critical/[0.08]", ink: "text-critical-ink" },
} as const;

/** Notice is a callout band: an error, a warning, or a note worth reading first. */
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
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className={`flex items-start gap-3 rounded-md border px-4 py-3 ${n.box} ${className}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${n.ink}`} />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title && <div className={`font-medium ${n.ink}`}>{title}</div>}
        {children && <div className="break-words text-foreground/85">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </motion.div>
  );
}

/** CopyButton copies a value and confirms it briefly, its icon swapping in place. */
export function CopyButton({ value, compact, className = "" }: { value: string; compact?: boolean; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
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
      className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:bg-foreground/5 hover:text-foreground ${className}`}
      aria-label={copied ? t("common.copied") : t("common.copy")}
      title={compact ? t("common.copy") : undefined}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.15 }}
          className="inline-flex"
        >
          {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
      {!compact && (copied ? t("common.copied") : t("common.copy"))}
    </button>
  );
}

/** Field is one labelled row of read-only detail: label above a mono value. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm tabular-nums">{children}</dd>
    </div>
  );
}
