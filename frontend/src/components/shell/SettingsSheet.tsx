import { createContext, lazy, ReactNode, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minimize2, Settings2 } from "lucide-react";
import { useT } from "../../i18n";
import { FADE_IN, FADE_OUT } from "../../lib/motion";
import { useSidebar } from "../../lib/sidebar";
import { Tooltip } from "../ui/Tooltip";
import { NODE_BAR_GAP, NODE_BAR_ROOM } from "./NodeBar";
import { TOP_BAR_HEIGHT } from "./TopBar";

const Settings = lazy(() => import("../../pages/Settings"));

/** How Settings grows out of its button, and shrinks back into it. */
export const SETTINGS_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;

export const SETTINGS_SECTIONS = [
  "general",
  "appearance",
  "accounts",
  "node",
  "network",
  "rpc",
  "assistants",
  "permissions",
  "diagnostics",
  "about",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * The pages a section drills into, in place of the section. Finding a
 * phrase's accounts carries the password that opened it and the accounts
 * first read, for as long as the page shows.
 */
export type SettingsPage =
  | { kind: "accounts.add" }
  | { kind: "accounts.import" }
  | { kind: "accounts.find"; seedId: string };

/** pageKey tells pages apart, for their transitions: by what they show, not the secrets they hold. */
export const pageKey = (p: SettingsPage) => (p.kind === "accounts.find" ? `${p.kind}:${p.seedId}` : p.kind);

// Whether Settings is open, over the page it was opened from, and the
// section it shows (kept while closed, so it reopens where it was left),
// and the page within it drilled into, if any (not kept: a flow left
// half done starts over)
type Sheet = {
  open: boolean;
  setOpen: (open: boolean) => void;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  page: SettingsPage | null;
  setPage: (page: SettingsPage | null) => void;
  /** openAt opens Settings at a section, or at a page within it. */
  openAt: (section: SettingsSection, page?: SettingsPage) => void;
};
const SheetContext = createContext<Sheet>({
  open: false,
  setOpen: () => {},
  section: "general",
  setSection: () => {},
  page: null,
  setPage: () => {},
  openAt: () => {},
});

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [section, setSectionState] = useState<SettingsSection>("general");
  const [page, setPage] = useState<SettingsPage | null>(null);
  // Choosing a section leaves the page drilled into
  const setSection = useCallback((s: SettingsSection) => {
    setSectionState(s);
    setPage(null);
  }, []);
  // Stable, so a caller's effect that opens Settings (OpenSettings, for
  // /accounts) runs once, not again on every section chosen after it
  const openAt = useCallback((s: SettingsSection, p?: SettingsPage) => {
    setSectionState(s);
    setPage(p ?? null);
    setOpen(true);
  }, []);
  useEffect(() => {
    if (!open) setPage(null);
  }, [open]);
  const value = useMemo(
    () => ({ open, setOpen, section, setSection, page, setPage, openAt }),
    [open, section, setSection, page, openAt],
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
  // In the sidebar's rail, the icon alone, its name in a tooltip
  const { collapsed } = useSidebar();
  if (open) return <div className="h-9" />;
  return (
    <Tooltip content={collapsed ? t("nav.settings") : null}>
      <motion.button
        type="button"
        layoutId="settings-surface"
        transition={SETTINGS_SPRING}
        onClick={() => setOpen(true)}
        aria-label={collapsed ? t("nav.settings") : undefined}
        className="group flex h-9 w-full items-center overflow-hidden px-2.5 text-left text-[15px] whitespace-nowrap text-foreground/80"
        style={{ borderRadius: 10 }}
      >
        <SettingsTitle label={t("nav.settings")} hidden={collapsed} />
      </motion.button>
    </Tooltip>
  );
}

function SettingsTitle({ label, large, hidden }: { label: string; large?: boolean; hidden?: boolean }) {
  return (
    <motion.span layoutId="settings-title" transition={SETTINGS_SPRING} className="flex items-center gap-3">
      <Settings2 className="size-[18px] shrink-0 text-brand" strokeWidth={1.75} />
      <motion.span
        className={large ? "text-base font-semibold text-foreground" : ""}
        initial={false}
        animate={{ opacity: hidden ? 0 : 1, transition: hidden ? FADE_OUT : { ...FADE_IN, delay: 0.08 } }}
      >
        {label}
      </motion.span>
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
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][aria-modal=true]"))
        setOpen(false);
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
