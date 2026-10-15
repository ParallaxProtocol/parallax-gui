import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { SidebarContext } from "./sidebar";

const COLLAPSED_KEY = "sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * SidebarProvider holds whether the sidebar is collapsed to its rail, for
 * the sidebar and for the title bar's button that toggles it, and
 * remembers it across launches. Ctrl+\ (⌘\ on macOS) toggles it too.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable: the sidebar just won't remember */
      }
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
