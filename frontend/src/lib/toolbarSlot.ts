import { createContext, useContext } from "react";

/**
 * The toolbar's accessory slot (toolbar.tsx), its context apart so a hot
 * update of the toolbar never makes a second one.
 */
type Slot = { el: HTMLElement | null; setEl: (el: HTMLElement | null) => void };

export const SlotContext = createContext<Slot>({ el: null, setEl: () => {} });

/** useToolbarSlot gives the toolbar the ref callback for its slot element. */
export const useToolbarSlot = () => useContext(SlotContext).setEl;
