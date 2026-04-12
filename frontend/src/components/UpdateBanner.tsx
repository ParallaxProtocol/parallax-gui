import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, openExternal } from "../lib/api";
import type { UpdateInfo, UpdateProgress } from "../lib/api";
import { useT } from "../i18n";

type BannerState =
  | { kind: "hidden" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number }
  | { kind: "verifying"; info: UpdateInfo }
  | { kind: "extracting"; info: UpdateInfo }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "error"; info: UpdateInfo; message: string };

export default function UpdateBanner() {
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const infoRef = useRef<UpdateInfo | null>(null);
  const t = useT();

  // Check for updates on mount.
  useEffect(() => {
    let cancelled = false;

    const check = () => {
      api.getLatestUpdate().then((info) => {
        if (cancelled) return;
        if (info) {
          infoRef.current = info;
          setState({ kind: "available", info });
        }
      }).catch(() => {});
    };

    check();

    // Re-check periodically (in case the background check found something).
    const id = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Subscribe to update-progress events from the backend.
  useEffect(() => {
    if (!window.runtime?.EventsOn) return;

    const unsub = window.runtime.EventsOn("update-progress", (p: UpdateProgress) => {
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
        case "error":
          setState({ kind: "error", info, message: p.detail });
          break;
      }
    });

    return unsub;
  }, []);

  const handleUpdate = () => {
    api.applyUpdate().catch((err) => {
      const info = infoRef.current;
      if (info) {
        setState({ kind: "error", info, message: String(err) });
      }
    });
  };

  const handleDismiss = () => {
    api.dismissUpdate().catch(() => {});
    setState({ kind: "hidden" });
  };

  const handleRestart = () => {
    api.restartApp().catch(() => {});
  };

  const handleRetry = () => {
    const info = infoRef.current;
    if (info) {
      setState({ kind: "available", info });
    }
  };

  const visible = state.kind !== "hidden";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="update-banner"
          className="fixed bottom-8 left-8 z-40 flex items-center gap-3 rounded-full border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-2.5 shadow-2xl max-w-[90vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {state.kind === "available" && (
            <>
              <div className="flex items-center gap-2 pl-1 pr-1">
                <span className="live-dot-warn" />
                <span className="text-xs text-fg">
                  {t("updater.available")}{" "}
                  <span className="text-gold font-medium">v{state.info.latestVersion}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => openExternal(state.info.releaseURL)}
                className="text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-1"
              >
                {t("updater.notes")}
              </button>
              <button
                type="button"
                onClick={handleUpdate}
                className="btn-primary !py-1.5 !px-4"
              >
                {t("updater.update")}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted hover:text-fg transition-colors px-1 text-sm leading-none"
                aria-label={t("updater.dismiss")}
              >
                &times;
              </button>
            </>
          )}

          {state.kind === "downloading" && (
            <>
              <div className="flex items-center gap-3 pl-1 pr-1 min-w-[180px]">
                <span className="text-xs text-fg whitespace-nowrap">
                  {t("updater.downloading", { version: state.info.latestVersion })}
                </span>
                <div className="flex-1 progress-track !h-1">
                  <div
                    className="progress-fill"
                    style={{ width: `${state.percent}%` }}
                  />
                </div>
                <span className="text-xs text-muted tabular-nums w-8 text-right">
                  {state.percent}%
                </span>
              </div>
            </>
          )}

          {state.kind === "verifying" && (
            <div className="flex items-center gap-2 pl-1 pr-1">
              <span className="live-dot-warn" />
              <span className="text-xs text-fg">{t("updater.verifying")}</span>
            </div>
          )}

          {state.kind === "extracting" && (
            <div className="flex items-center gap-2 pl-1 pr-1">
              <span className="live-dot-warn" />
              <span className="text-xs text-fg">{t("updater.installing")}</span>
            </div>
          )}

          {state.kind === "ready" && (
            <>
              <div className="flex items-center gap-2 pl-1 pr-1">
                <span className="live-dot-success" />
                <span className="text-xs text-fg">
                  {t("updater.installed", { version: state.info.latestVersion })}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRestart}
                className="btn-primary !py-1.5 !px-4"
              >
                {t("updater.restartNow")}
              </button>
            </>
          )}

          {state.kind === "error" && (
            <>
              <div className="flex items-center gap-2 pl-1 pr-1">
                <span className="live-dot-err" />
                <span className="text-xs text-danger max-w-[260px] truncate">
                  {state.message}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-2"
              >
                {t("updater.retry")}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-muted hover:text-fg transition-colors px-1 text-sm leading-none"
                aria-label={t("updater.dismiss")}
              >
                &times;
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
