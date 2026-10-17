import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SheetContext, type SettingsPage, type SettingsSection } from "./settingsSheet";

/**
 * SettingsSheetProvider holds whether Settings is open and where (settingsSheet.ts),
 * in a module of its own so the sheet hot-reloads in place during development.
 */
export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [section, setSectionState] = useState<SettingsSection>("general");
  const [page, setPage] = useState<SettingsPage | null>(null);
  // Whether it is open, read as it opens without a re-render
  const wasOpen = useRef(false);
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
    wasOpen.current = true;
    setOpenState(true);
  }, []);
  // Opened as it is (its button, its shortcut), it starts at General, not
  // the section it was left at; closing leaves the section be, so the
  // panel doesn't change as it goes
  const setOpen = useCallback((o: boolean) => {
    if (o && !wasOpen.current) {
      setSectionState("general");
      setPage(null);
    }
    wasOpen.current = o;
    setOpenState(o);
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
