import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, onEvent } from "./api";
import type { UpdateInfo, UpdateProgress } from "./api";
import { UpdateContext, type UpdateCtx, type UpdateState } from "./updateContext";

/**
 * UpdateProvider follows the app's own updates: whether a new release is
 * out (told by the backend the moment its check finds one), and its
 * download, verification and install once the user takes it. A new
 * release is the top bar's Update button alone, not a notification too.
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({ kind: "hidden" });
  const infoRef = useRef<UpdateInfo | null>(null);
  // Whether an update is under way, for a release found meanwhile to wait
  const working = useRef(false);
  working.current = state.kind !== "hidden" && state.kind !== "available";

  useEffect(() => {
    let cancelled = false;
    const offer = (info: UpdateInfo) => {
      // A later find must not knock an install in progress back to the offer
      if (working.current) return;
      infoRef.current = info;
      setState({ kind: "available", info });
    };
    // What a check already found before the app was here to be told, then
    // each release a check finds, as it finds it
    api
      .getLatestUpdate()
      .then((info) => !cancelled && info && offer(info))
      .catch(() => {});
    const off = onEvent<UpdateInfo>("update-available", offer);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

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

  const value = useMemo<UpdateCtx>(
    () => ({
      state,
      update: () => {
        api.applyUpdate().catch((err) => {
          const info = infoRef.current;
          if (info) setState({ kind: "error", info, message: String(err) });
        });
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

export { useUpdate, type UpdateState } from "./updateContext";
