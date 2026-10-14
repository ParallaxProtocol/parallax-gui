import { Download, X } from "lucide-react";
import { api, openExternal } from "../lib/api";
import { useUpdate } from "../lib/update";
import { useT } from "../i18n";
import { Indicator } from "./ui/Indicator";
import { Meter } from "./ui/bits";
import { Tooltip } from "./ui/Tooltip";

/**
 * UpdatePanel is the top bar's update popover: it offers a new release and
 * follows its download, verification and install.
 */
export default function UpdatePanel() {
  const t = useT();
  const { state, update, dismiss, retry } = useUpdate();

  const Close = () => (
    <button
      type="button"
      onClick={dismiss}
      className="btn btn-ghost btn-sm btn-icon -mr-1"
      aria-label={t("updater.dismiss")}
    >
      <X className="size-4" />
    </button>
  );

  return (
    <div role="status">
      {state.kind === "available" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-muted text-brand">
              <Download className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t("updater.available")}</div>
              <div className="text-sm text-muted-foreground">v{state.info.latestVersion}</div>
            </div>
            <Close />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => openExternal(state.info.releaseURL)} className="btn btn-secondary">
              {t("updater.notes")}
            </button>
            <button type="button" onClick={update} className="btn btn-primary">
              {t("updater.update")}
            </button>
          </div>
        </div>
      )}

      {state.kind === "downloading" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span>{t("updater.downloading", { version: state.info.latestVersion })}</span>
            <span className="text-sm text-muted-foreground tabular-nums">{state.percent}%</span>
          </div>
          <Meter value={state.percent / 100} />
        </div>
      )}

      {(state.kind === "verifying" || state.kind === "extracting") && (
        <div className="flex flex-col gap-2.5">
          <span>{state.kind === "verifying" ? t("updater.verifying") : t("updater.installing")}</span>
          <Meter />
        </div>
      )}

      {state.kind === "ready" && (
        <div className="flex items-center gap-3">
          <Indicator grade="good" ping />
          <span className="flex-1">{t("updater.installed", { version: state.info.latestVersion })}</span>
          <button type="button" onClick={() => api.restartApp().catch(() => {})} className="btn btn-primary">
            {t("updater.restartNow")}
          </button>
        </div>
      )}

      {state.kind === "ready-manual" && (
        <div className="flex items-start gap-3">
          <Indicator grade="good" className="mt-1.5" />
          <span className="flex-1">{t("updater.dragToApplications", { version: state.info.latestVersion })}</span>
          <Close />
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Indicator grade="critical" className="mt-1.5" />
            <Tooltip content={state.message} overflowOnly>
              <span className="selectable line-clamp-3 flex-1 text-critical-ink">{state.message}</span>
            </Tooltip>
            <Close />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={retry} className="btn btn-secondary">
              {t("updater.retry")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
