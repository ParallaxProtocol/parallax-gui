import type { ReactNode } from "react";
import { CircleCheck, Download, OctagonAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { api, openExternal } from "../lib/api";
import { useUpdate } from "../lib/update";
import { useLang, useT } from "../i18n";
import { Modal } from "./ui/Modal";
import { Markdown } from "./ui/Markdown";
import { Meter } from "./ui/bits";
import { Tooltip } from "./ui/Tooltip";

/** The ink each tone's symbol is drawn in, as a CardRow's. */
const INK = { brand: "text-brand", good: "text-good-ink", critical: "text-critical-ink" } as const;

/**
 * UpdateModal is what the top bar's Update button opens: the notes of every
 * release from the one running to the latest, newest first, in full, to
 * read before taking them, and at its foot the update
 * itself, from the offer through its download, verification and install
 * to the restart. Closing it only closes it: the button stays until the
 * update is installed.
 */
export default function UpdateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { state, update, retry } = useUpdate();
  if (state.kind === "hidden") return null;
  const { info } = state;
  const version = info.latestVersion;
  const date = (iso: string) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString(lang, { dateStyle: "long" }) : "";
  };
  // From the version running to the one on offer: the names are the same in every language
  const subtitle = `Parallax Wallet ${info.currentVersion} → ${version}`;
  const releases = info.releases?.length
    ? info.releases
    : [{ version, publishedAt: info.publishedAt, url: info.releaseURL, notes: "" }];

  // A step at the foot: its symbol tinted in its tone, what's happening, and its progress or actions
  const step = (icon: LucideIcon, tone: keyof typeof INK, text: ReactNode, end?: ReactNode, below?: ReactNode) => {
    const Icon = icon;
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <Icon className={`size-5 shrink-0 ${INK[tone]}`} strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1 text-sm">{text}</div>
          {end && <div className="flex shrink-0 gap-2">{end}</div>}
        </div>
        {below && <div className="pl-8">{below}</div>}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("updater.available")}
      subtitle={subtitle}
      icon={<Download />}
      // The update, the step it's at, under the notes
      footer={
        <div className="border-t border-border bg-surface/60 px-5 py-3" role="status">
          {state.kind === "available" && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openExternal(info.releaseURL)} className="btn btn-ghost -ml-2">
                {t("updater.viewOnGitHub")}
              </button>
              <span className="flex-1" />
              <button type="button" onClick={update} className="btn btn-primary">
                {t("updater.update")}
              </button>
            </div>
          )}

          {state.kind === "downloading" &&
            step(
              Download,
              "brand",
              t("updater.downloading", { version }),
              <span className="text-sm text-muted-foreground tabular-nums">{state.percent}%</span>,
              <Meter value={state.percent / 100} live />,
            )}

          {(state.kind === "verifying" || state.kind === "extracting") &&
            step(
              ShieldCheck,
              "brand",
              state.kind === "verifying" ? t("updater.verifying") : t("updater.installing"),
              undefined,
              <Meter />,
            )}

          {state.kind === "ready" &&
            step(
              CircleCheck,
              "good",
              <>
                <span className="font-medium">{t("updater.installed", { version })}</span>
                <span className="block text-muted-foreground">{t("updater.restartDesc")}</span>
              </>,
              <button type="button" onClick={() => api.restartApp().catch(() => {})} className="btn btn-primary">
                {t("updater.restartNow")}
              </button>,
            )}

          {state.kind === "ready-manual" &&
            step(
              CircleCheck,
              "good",
              <>
                <span className="font-medium">{t("updater.downloaded", { version })}</span>
                <span className="block text-muted-foreground">{t("updater.dragDesc")}</span>
              </>,
            )}

          {state.kind === "error" &&
            step(
              OctagonAlert,
              "critical",
              <>
                <span className="font-medium">{t("updater.failed")}</span>
                <Tooltip content={state.message} overflowOnly>
                  <span className="selectable line-clamp-2 text-muted-foreground">{state.message}</span>
                </Tooltip>
              </>,
              <button type="button" onClick={retry} className="btn btn-secondary">
                {t("updater.retry")}
              </button>,
            )}
        </div>
      }
    >
      {/* Each release's notes as it has them, newest first, parted by a line across the dialog, as its header and footer are */}
      <div className="flex flex-col divide-y divide-border-strong">
        {releases.map((r) => (
          <section key={r.version} className="flex flex-col gap-3 px-5 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight">
                {t("updater.availableDesc", { version: r.version })}
              </h3>
              <span className="shrink-0 text-sm text-muted-foreground">{date(r.publishedAt)}</span>
            </div>
            {r.notes.trim() ? (
              <Markdown text={r.notes} className="selectable" />
            ) : (
              <p className="text-muted-foreground">{t("updater.noNotes")}</p>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
