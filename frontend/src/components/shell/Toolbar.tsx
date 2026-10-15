import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { FADE_IN, FADE_OUT } from "../../lib/motion";
import { useToolbarSlot } from "../../lib/toolbar";
import { useWallet } from "../../lib/wallet";
import { useOfflineMode } from "../../lib/offline";
import { useT } from "../../i18n";

/** The title bar's height (h-14), which the page keeps clear when it scrolls to a field. */
export const TOOLBAR_HEIGHT = 56;

const TITLES: Record<string, string> = {
  "/": "nav.overview",
  "/send": "nav.send",
  "/receive": "nav.receive",
  "/contacts": "nav.contacts",
  "/sign": "offline.nav.sign",
  "/messages/sign": "nav.signMessage",
  "/messages/verify": "nav.verifyMessage",
  "/broadcast": "offline.nav.broadcast",
  "/accounts/watch": "offline.watch.title",
  "/accounts/new": "wallet.create.title",
  "/accounts/import": "wallet.import.title",
  "/setup": "wallet.setup.title",
};

/**
 * Toolbar is the content's title bar: the page's name, and on the right
 * whatever the page puts there (lib/toolbar.tsx): its progress, its
 * actions. It sits under the window's title bar (TopBar), which alone
 * drags the window: this is the page's, not the window's. It stays at the
 * top of the page's scroller, and once the page scrolls beneath it, the
 * page fades and blurs away under it (as Apple's scroll edge effect does)
 * rather than meeting a hard surface: its controls float there on glass.
 */
export default function Toolbar() {
  const t = useT();
  const { pathname } = useLocation();
  const scrolled = useScrolled(pathname);
  const slot = useToolbarSlot();
  const { info } = useWallet();
  // The home page is the welcome until the wallet has its password
  const offline = useOfflineMode();
  const title =
    pathname === "/" && info && !info.hasPassword
      ? "nav.welcome"
      : pathname === "/" && offline
        ? "offline.mode"
        : (TITLES[pathname] ?? TITLES["/"]);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 pl-5">
      {/* The scroll edge: frosted under the title, thinning out to nothing a
          little past the bar's foot, its blur fading with it */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 -bottom-4 bg-background/80 backdrop-blur-md transition-opacity duration-300 [mask-image:linear-gradient(to_bottom,black_50%,transparent)] ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="relative h-9 min-w-0 flex-1">
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
      <div ref={slot} className="relative flex min-w-0 shrink-0 items-center" />
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
