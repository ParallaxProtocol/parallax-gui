import { ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { FADE_IN } from "./motion";
import { SlotContext } from "./toolbarSlot";

/**
 * The toolbar's accessory slot: the page on screen puts its own controls
 * in the window's title bar, beside its name (a step indicator, the
 * actions on the whole page), instead of a header row of its own. The
 * toolbar provides the element; a page renders <ToolbarAccessory> anywhere
 * in its tree and the content goes there, for as long as the page shows.
 */
export function ToolbarSlotProvider({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return <SlotContext.Provider value={{ el, setEl }}>{children}</SlotContext.Provider>;
}

export { useToolbarSlot } from "./toolbarSlot";

/** ToolbarAccessory shows its children in the toolbar, fading in as the page arrives. */
export function ToolbarAccessory({ children }: { children: ReactNode }) {
  const { el } = useContext(SlotContext);
  if (!el) return null;
  return createPortal(
    <motion.div
      className="flex items-center gap-2 text-sm text-muted-foreground"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: FADE_IN }}
    >
      {children}
    </motion.div>,
    el,
  );
}
