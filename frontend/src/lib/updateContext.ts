import { createContext, useContext } from "react";
import type { UpdateInfo } from "./api";

// The context lives apart from its provider (update.tsx), which imports the
// strings: a module that makes a context must never be re-run by a hot
// update during development, or the app gets a second context, remounts
// under it, and whatever kept the first reads its defaults
export type UpdateState =
  | { kind: "hidden" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number }
  | { kind: "verifying"; info: UpdateInfo }
  | { kind: "extracting"; info: UpdateInfo }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "ready-manual"; info: UpdateInfo }
  | { kind: "error"; info: UpdateInfo; message: string };

export type UpdateCtx = {
  state: UpdateState;
  update: () => void;
  dismiss: () => void;
  retry: () => void;
};

export const UpdateContext = createContext<UpdateCtx>({
  state: { kind: "hidden" },
  update: () => {},
  dismiss: () => {},
  retry: () => {},
});

export const useUpdate = () => useContext(UpdateContext);
