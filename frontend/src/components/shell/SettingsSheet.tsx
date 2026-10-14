import { createContext, lazy, ReactNode, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minimize2, Settings2 } from "lucide-react";
import { useT } from "../../i18n";
import { Tooltip } from "../ui/Tooltip";
import { NODE_BAR_GAP, NODE_BAR_ROOM } from "./NodeBar";
import { TOP_BAR_HEIGHT } from "./TopBar";

const Settings = lazy(() => import("../../pages/Settings"));

/** How Settings grows out of its button, and shrinks back into it. */
export const SETTINGS_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;

export const SETTINGS_SECTIONS = ["accounts", "general", "appearance", "node", "network", "rpc", "diagnostics", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

// Whether Settings is open, over the page it was opened from, and the
// section it shows (kept while closed, so it reopens where it was left)
type Sheet = {
  open: boolean;
  setOpen: (open: boolean) => void;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  /** openAt opens Settings at a section. */
  openAt: (section: SettingsSection) => void;
};
const SheetContext = createContext<Sheet>({
  open: false,
  setOpen: () => {},
  section: "accounts",
  setSection: () => {},
  openAt: () => {},
});

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("accounts");
  const value = useMemo(
    () => ({
      open,
      setOpen,
      section,
      setSection,
      openAt: (s: SettingsSection) => {
        setSection(s);
        setOpen(true);
      },
    }),
    [open, section],
  );
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

export const useSettingsSheet = () => useContext(SheetContext);

/**
 * SettingsButton is Settings at the sidebar's foot. Its face and its title
 * are shared with SettingsSheet (layoutId), so opening grows the button
 * into the panel and its title moves to the panel's top.
 */
export function SettingsButton() {
  const t = useT();
  const { open, setOpen } = useSettingsSheet();
  if (open) return <div className="h-9" />;
  return (
    <motion.button
      type="button"
      layoutId="settings-surface"
      transition={SETTINGS_SPRING}
      onClick={() => setOpen(true)}
      className="group flex h-9 w-full items-center px-2.5 text-left text-foreground/80 hover:bg-hover"
      style={{ borderRadius: 10 }}
    >
      <SettingsTitle label={t("nav.settings")} />
    </motion.button>
  );
}

function SettingsTitle({ label, large }: { label: string; large?: boolean }) {
  return (
    <motion.span layoutId="settings-title" transition={SETTINGS_SPRING} className="flex items-center gap-2.5">
      <Settings2 className="size-4 text-muted-foreground" strokeWidth={1.75} />
      <span className={large ? "text-base font-semibold text-foreground" : ""}>{label}</span>
    </motion.span>
  );
}

/**
 * SettingsSheet is Settings in a floating panel over the page, under the
 * window's title bar and in the node bar's glass, grown out of its button in the sidebar: the button's title
 * moves to the panel's top, the collapse button across from it, and the
 * settings arrive beneath. Collapsing, or Escape, shrinks it into the
 * button again.
 */
export default function SettingsSheet() {
  const t = useT();
  const { open, setOpen } = useSettingsSheet();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog of the settings takes its own Escape
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][aria-modal=true]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="settings"
          aria-label={t("nav.settings")}
          layoutId="settings-surface"
          transition={SETTINGS_SPRING}
          className="no-drag fixed z-30 flex flex-col overflow-hidden border border-glass-edge bg-popover/80 shadow-[var(--glass-shine),var(--shadow-popover)] backdrop-blur-2xl"
          style={{
            top: TOP_BAR_HEIGHT,
            left: NODE_BAR_GAP,
            right: NODE_BAR_GAP,
            bottom: NODE_BAR_ROOM,
            borderRadius: 16,
          }}
        >
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border pr-2 pl-4">
            <SettingsTitle label={t("nav.settings")} large />
            <span className="flex-1" />
            <Tooltip content={t("common.close")}>
              <motion.button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.25 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <Minimize2 className="size-4" />
              </motion.button>
            </Tooltip>
          </header>
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.14, duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <Suspense fallback={null}>
              <Settings />
            </Suspense>
          </motion.div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
