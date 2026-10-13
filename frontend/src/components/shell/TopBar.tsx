import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Pickaxe } from "lucide-react";
import { formatHashrate } from "../../lib/format";
import { useLive } from "../../lib/live";
import { FADE_IN, FADE_OUT, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { Indicator } from "../ui/Indicator";
import { Rolling } from "../ui/Rolling";

const PAGES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "nav.overview", subtitle: "page.overview.subtitle" },
  "/wallet": { title: "nav.wallet", subtitle: "page.wallet.subtitle" },
  "/mining": { title: "nav.mining", subtitle: "page.mining.subtitle" },
  "/settings": { title: "nav.settings", subtitle: "page.settings.subtitle" },
};

/**
 * TopBar names the page and carries the live chips: the wallet while one
 * is talking to the node, the miner while it runs. Each chip slides in
 * when its state starts and links to its page.
 */
export default function TopBar() {
  const t = useT();
  const { pathname } = useLocation();
  const { wallet, miner } = useLive();
  const page = PAGES[pathname] ?? PAGES["/"];

  return (
    <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between gap-6 border-b border-border bg-background px-10">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          className="min-w-0"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: FADE_IN }}
          exit={{ opacity: 0, transition: FADE_OUT }}
        >
          <h1 className="text-[26px] leading-none">{t(page.title)}</h1>
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{t(page.subtitle)}</p>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <AnimatePresence initial={false}>
          {wallet.connected && (
            <Chip key="wallet" to="/wallet">
              <Indicator grade="good" ping cause="wallet" />
              {t("chip.wallet")}
            </Chip>
          )}
          {miner?.running && (
            <Chip key="miner" to="/mining">
              <Pickaxe className="size-3.5 text-brand" />
              <span className="font-mono tabular-nums">
                <Rolling value={formatHashrate(miner.hashrate)} />
              </span>
            </Chip>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

function Chip({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, x: 8 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: FADE_OUT }}
      transition={SPRING}
    >
      <Link
        to={to}
        className="flex h-8 items-center gap-2 rounded-full border border-border-strong bg-surface-elevated px-3 text-xs transition-colors hover:border-brand/50"
      >
        {children}
      </Link>
    </motion.div>
  );
}
