import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { FADE_IN, FADE_OUT } from "../../lib/motion";
import { useToolbarSlot } from "../../lib/toolbar";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";

const TITLES: Record<string, string> = {
  "/": "nav.overview",
  "/send": "nav.send",
  "/receive": "nav.receive",
  "/contacts": "nav.contacts",
  "/accounts/new": "wallet.create.title",
  "/accounts/import": "wallet.import.title",
  "/setup": "wallet.setup.title",
};

/**
 * Toolbar is the content's title bar: the page's name, and on the right
 * whatever the page puts there (lib/toolbar.tsx): its progress, its
 * actions. It is a drag area, under the window's title bar (TopBar). Its separator shows only once content scrolls beneath it, as
 * on macOS.
 */
export default function Toolbar() {
  const t = useT();
  const { pathname } = useLocation();
  const scrolled = useScrolled(pathname);
  const slot = useToolbarSlot();
  const { info } = useWallet();
  // The home page is the welcome until the wallet has its password
  const title = pathname === "/" && info && !info.hasPassword ? "nav.welcome" : (TITLES[pathname] ?? TITLES["/"]);

  return (
    <header
      className={`drag relative z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background pl-5 transition-[border-color,box-shadow] duration-200 ${
        scrolled ? "border-border shadow-[0_6px_16px_-12px_rgb(0_0_0/40%)]" : "border-transparent"
      }`}
    >
      <div className="relative h-9 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.h1
            key={`${pathname}:${title}`}
            className="absolute inset-0 flex items-center truncate text-2xl font-semibold tracking-tight"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: FADE_IN }}
            exit={{ opacity: 0, y: -8, transition: FADE_OUT }}
          >
            {t(title)}
          </motion.h1>
        </AnimatePresence>
      </div>
      <div ref={slot} className="flex min-w-0 shrink-0 items-center" />
      <span className="w-5 shrink-0" />
    </header>
  );
}

/** Whether any scroll container of the page is scrolled from its top; reset on navigation. */
function useScrolled(pathname: string) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    setScrolled(false);
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLElement && el.closest("main")) setScrolled(el.scrollTop > 2);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [pathname]);
  return scrolled;
}
