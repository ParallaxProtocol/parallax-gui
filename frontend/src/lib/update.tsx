import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, onEvent } from "./api";
import type { UpdateInfo, UpdateProgress } from "./api";
import { useNotifications } from "./notifications";
import { useT } from "../i18n";

export type UpdateState =
  | { kind: "hidden" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number }
  | { kind: "verifying"; info: UpdateInfo }
  | { kind: "extracting"; info: UpdateInfo }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "ready-manual"; info: UpdateInfo }
  | { kind: "error"; info: UpdateInfo; message: string };

type Ctx = {
  state: UpdateState;
  update: () => void;
  dismiss: () => void;
  retry: () => void;
};

const UpdateContext = createContext<Ctx>({ state: { kind: "hidden" }, update: () => {}, dismiss: () => {}, retry: () => {} });

/**
 * UpdateProvider follows the app's own updates: whether a new release is
 * out (checked every minute), and its download, verification and install
 * once the user takes it. A new release is also a notification, once.
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const { push } = useNotifications();
  const [state, setState] = useState<UpdateState>({ kind: "hidden" });
  const infoRef = useRef<UpdateInfo | null>(null);
  const announced = useRef("");

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
          if (announced.current !== info.latestVersion) {
            announced.current = info.latestVersion;
            push("update", t("updater.available"), `v${info.latestVersion}`);
          }
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
  }, [push, t]);

  useEffect(
    () =>
      onEvent<UpdateProgress>("update-progress", (p) => {
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
      }),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      update: () => {
        api.applyUpdate().catch((err) => {
          const info = infoRef.current;
          if (info) setState({ kind: "error", info, message: String(err) });
        });
      },
      dismiss: () => {
        api.dismissUpdate().catch(() => {});
        setState({ kind: "hidden" });
      },
      retry: () => {
        const info = infoRef.current;
        if (info) setState({ kind: "available", info });
      },
    }),
    [state],
  );
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export const useUpdate = () => useContext(UpdateContext);
