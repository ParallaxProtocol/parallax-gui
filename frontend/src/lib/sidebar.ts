import { createContext, useContext } from "react";

/** The sidebar's width open, and collapsed to its rail of icons. */
export const SIDEBAR_WIDTH = 272;
export const SIDEBAR_RAIL = 64;
/** On macOS the rail is wider, to keep room for the traffic lights over it. */
export const SIDEBAR_RAIL_MAC = 80;

/** macOS keeps its traffic lights at the window's top left (public/boot.js marks the platform). */
export const MAC = document.documentElement.dataset.platform === "darwin";
/**
 * On macOS the title bar is taller: a row of its own for the traffic lights
 * (desktop/src/main.ts sets them in it), the sidebar's logo and name and the
 * top bar's buttons in the row below.
 */
export const TRAFFIC_LIGHTS_ROW = MAC ? 32 : 0;

export type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
};

export const SidebarContext = createContext<SidebarState>({ collapsed: false, toggle: () => {} });

export const useSidebar = () => useContext(SidebarContext);
