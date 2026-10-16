import { createContext, useContext } from "react";

/**
 * The node's power switch, shared by the node bar and the node's page under
 * it: one busy state and one error, so whichever button was pressed, the
 * other shows it connecting too.
 */
export type NodeSwitch = {
  busy: boolean;
  err: string | null;
  /** Starts the node when it's stopped, stops it when it's running. */
  toggle: () => Promise<void>;
};

export const NodeSwitchContext = createContext<NodeSwitch>({
  busy: false,
  err: null,
  toggle: async () => {},
});

export const useNodeSwitch = () => useContext(NodeSwitchContext);
