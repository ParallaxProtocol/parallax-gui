import { createContext, useContext } from "react";

// Whether the node bar is opened into the node's page, for the shell and
// for whatever opens it (the /node route). Apart from the bar (NodeBar.tsx),
// so a hot update of the bar never makes a second context
type Sheet = { open: boolean; setOpen: (open: boolean) => void };
export const NodeSheetContext = createContext<Sheet>({ open: false, setOpen: () => {} });

export const useNodeSheet = () => useContext(NodeSheetContext);
