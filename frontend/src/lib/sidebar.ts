import { createContext, useContext } from "react";

/** The sidebar's width open, and collapsed to its rail of icons. */
export const SIDEBAR_WIDTH = 272;
export const SIDEBAR_RAIL = 64;
/** On macOS the rail is wider, to keep room for the traffic lights over it. */
export const SIDEBAR_RAIL_MAC = 80;

export type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
};

export const SidebarContext = createContext<SidebarState>({ collapsed: false, toggle: () => {} });

export const useSidebar = () => useContext(SidebarContext);
