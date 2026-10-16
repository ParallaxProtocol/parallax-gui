/**
 * BAR_SURFACE is the floating bars' glass at the window's foot (the node
 * bar, the offline bar, the assistant bar): one definition, so they stay
 * alike.
 */
export const BAR_SURFACE =
  "border border-glass-edge bg-popover/80 shadow-[var(--glass-shine),var(--shadow-popover)] backdrop-blur-2xl";

/**
 * BAR_GLASS is the bars' glass at rest: the cards' frosted glass (.glass),
 * as the empty wallet's Settings pill, lighter than BAR_SURFACE. A bar
 * opened into a page or a request takes BAR_SURFACE, thick enough to read
 * over the page. BAR_FADE lets the one give way to the other smoothly.
 */
export const BAR_GLASS =
  "border border-glass-edge bg-[var(--glass)] shadow-[var(--glass-shine),var(--glass-drop)] backdrop-blur-[24px] backdrop-saturate-150";
export const BAR_FADE = "transition-[background-color,box-shadow] duration-300";
