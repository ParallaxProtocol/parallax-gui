import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";
import { api, openExternal } from "../lib/api";
import type { UpdateInfo, UpdateProgress } from "../lib/api";
import { SPRING } from "../lib/motion";
import { useT } from "../i18n";
import { Indicator } from "./ui/Indicator";
import { Meter } from "./ui/bits";

type BannerState =
  | { kind: "hidden" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number }
  | { kind: "verifying"; info: UpdateInfo }
  | { kind: "extracting"; info: UpdateInfo }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "ready-manual"; info: UpdateInfo }
  | { kind: "error"; info: UpdateInfo; message: string };

/**
 * UpdateBanner is a toast in the bottom-right corner that offers a new
 * release and follows its download, verification and install.
 */
export default function UpdateBanner() {
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const infoRef = useRef<UpdateInfo | null>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api
        .getLatestUpdate()
        .then((info) => {
          if (cancelled || !info) return;
          infoRef.current = info;
          // A poll must not knock an install in progress back to the offer
          setState((s) => (s.kind === "hidden" ? { kind: "available", info } : s));
        })
        .catch(() => {});
    };
    check();
    // Re-check periodically, in case the background check found something
    const id = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!window.runtime?.EventsOn) return;
    return window.runtime.EventsOn("update-progress", (p: UpdateProgress) => {
      const info = infoRef.current;
      if (!info) return;
      switch (p.step) {
        case "downloading":
          setState({ kind: "downloading", info, percent: p.percent });
          break;
        case "verifying":
          setState({ kind: "verifying", info });
          break;
        case "extracting":
          setState({ kind: "extracting", info });
          break;
        case "ready":
          setState({ kind: "ready", info });
          break;
        case "ready-manual":
          setState({ kind: "ready-manual", info });
          break;
        case "error":
          setState({ kind: "error", info, message: p.detail });
          break;
      }
    });
  }, []);

  const update = () => {
    api.applyUpdate().catch((err) => {
      const info = infoRef.current;
      if (info) setState({ kind: "error", info, message: String(err) });
    });
  };

  const dismiss = () => {
    api.dismissUpdate().catch(() => {});
    setState({ kind: "hidden" });
  };

  const Close = () => (
    <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm -mr-1 px-1.5" aria-label={t("updater.dismiss")}>
      <X className="size-4" />
    </button>
  );

  return (
    <AnimatePresence>
      {state.kind !== "hidden" && (
        <motion.div
          key="update-banner"
          className="fixed right-6 bottom-6 z-50 w-[360px] rounded-md border border-border-strong bg-surface-elevated p-4 shadow-2xl"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24 }}
          transition={SPRING}
          role="status"
        >
          {state.kind === "available" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="brand-gradient grid size-8 shrink-0 place-items-center rounded-md text-brand-foreground">
                  <Download className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t("updater.available")}</div>
                  <div className="font-mono text-xs text-brand">v{state.info.latestVersion}</div>
                </div>
                <Close />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => openExternal(state.info.releaseURL)} className="btn btn-ghost btn-sm">
                  {t("updater.notes")}
                </button>
                <button type="button" onClick={update} className="btn btn-primary btn-sm">
                  {t("updater.update")}
                </button>
              </div>
            </div>
          )}

          {state.kind === "downloading" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{t("updater.downloading", { version: state.info.latestVersion })}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{state.percent}%</span>
              </div>
              <Meter value={state.percent / 100} />
            </div>
          )}

          {(state.kind === "verifying" || state.kind === "extracting") && (
            <div className="flex flex-col gap-2.5">
              <span className="text-sm">
                {state.kind === "verifying" ? t("updater.verifying") : t("updater.installing")}
              </span>
              <Meter />
            </div>
          )}

          {state.kind === "ready" && (
            <div className="flex items-center gap-3">
              <Indicator grade="good" ping />
              <span className="flex-1 text-sm">{t("updater.installed", { version: state.info.latestVersion })}</span>
              <button type="button" onClick={() => api.restartApp().catch(() => {})} className="btn btn-primary btn-sm">
                {t("updater.restartNow")}
              </button>
            </div>
          )}

          {state.kind === "ready-manual" && (
            <div className="flex items-start gap-3">
              <Indicator grade="good" className="mt-1.5" />
              <span className="flex-1 text-sm">{t("updater.dragToApplications", { version: state.info.latestVersion })}</span>
              <Close />
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Indicator grade="critical" className="mt-1.5" />
                <span className="line-clamp-3 flex-1 text-sm text-critical-ink" title={state.message}>
                  {state.message}
                </span>
                <Close />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => infoRef.current && setState({ kind: "available", info: infoRef.current })}
                  className="btn btn-secondary btn-sm"
                >
                  {t("updater.retry")}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
