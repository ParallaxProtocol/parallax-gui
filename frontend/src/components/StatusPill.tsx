/**
 * StatusPill renders a state pill with an optional pulsing dot.
 *
 *   ● Syncing      (blue pulse)
 *   ● Synced       (green pulse)
 *   ● Offline      (red, no pulse) — node is not running
 *
 * The pulse uses a CSS animation (defined in tailwind.config.ts) — no JS
 * timer, so it stays in sync with the browser's compositor.
 */
import { useT } from "../i18n";

export type StatusKind = "syncing" | "synced" | "stopped";

const VARIANTS: Record<
  StatusKind,
  { className: string; dot: string; labelKey: string }
> = {
  syncing: {
    className: "pill-info",
    dot: "live-dot-info",
    labelKey: "status.syncing",
  },
  synced: {
    className: "pill-ok",
    dot: "live-dot-success",
    labelKey: "status.synced",
  },
  stopped: {
    className: "pill-err",
    dot: "live-dot-err",
    labelKey: "status.offline",
  },
};

export default function StatusPill({
  kind,
  label,
}: {
  kind: StatusKind;
  label?: string;
}) {
  const t = useT();
  const v = VARIANTS[kind];
  return (
    <span className={v.className}>
      <span className={v.dot} />
      {label ?? t(v.labelKey)}
    </span>
  );
}
