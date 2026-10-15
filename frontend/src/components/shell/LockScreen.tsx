import { useEffect, useId, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Loader2, LockOpen } from "lucide-react";
import { api, walletError } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { EASE, Glow } from "../ui/Glow";
import logo from "../../assets/logo.svg";
import { Notice } from "../ui/bits";
import { PasswordInput } from "../../pages/Wallet/common";

/** How often, at most, activity in the window puts off the wallet's auto-lock. */
const TOUCH_EVERY_MS = 30_000;

/** What counts as the user being at the app. */
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * LockGate shows the app while the wallet is unlocked, and the lock screen
 * while it is locked (backend/session.go): nothing of the app is mounted
 * behind it, so no page or form keeps what it held. Until the wallet first
 * answers it shows nothing, so the app never flashes up before the lock
 * screen. While unlocked, the user's activity in the window puts off the
 * auto-lock.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const { info } = useWallet();
  const locked = !!info?.locked;
  const unlocked = !!info?.hasPassword && !locked;

  useEffect(() => {
    if (!unlocked) return;
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < TOUCH_EVERY_MS) return;
      last = now;
      api.walletTouch().catch(() => {});
    };
    for (const e of ACTIVITY) window.addEventListener(e, touch, { capture: true, passive: true });
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch, { capture: true });
    };
  }, [unlocked]);

  if (!info) return null;
  if (locked) return <LockScreen />;
  return <>{children}</>;
}

/** LockScreen asks for the wallet password, and unlocks the wallet with it. */
function LockScreen() {
  const t = useT();
  const { refresh } = useWallet();
  const id = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPassword(""), []);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.walletUnlock(password);
      setPassword("");
      await refresh();
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <Glow />
      {/* The window's title bar: draggable, with room for its controls */}
      <div className="drag absolute inset-x-0 top-0 z-10 h-13" />
      <div className="relative grid h-full place-items-center px-6">
        <form
          className="flex w-full max-w-sm flex-col items-center gap-10"
          onSubmit={(e) => {
            e.preventDefault();
            unlock();
          }}
        >
          {/* The logo and the title come in as the welcome's do, then the rest after them */}
          <div className="flex flex-col items-center gap-6">
            <motion.span
              aria-hidden
              className="block size-20 bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)]"
              style={{
                mask: `url("${logo}") center / contain no-repeat`,
                WebkitMask: `url("${logo}") center / contain no-repeat`,
              }}
              initial={{ opacity: 0, scale: 0.9, filter: "blur(12px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.9, ease: EASE }}
            />
            <motion.h1
              className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text px-2 pb-1 text-center text-5xl font-semibold tracking-tight text-transparent"
              initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.15, duration: 0.55, ease: EASE }}
            >
              {t("lock.title")}
            </motion.h1>
          </div>
          <motion.div
            className="flex w-full flex-col items-center gap-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6, ease: EASE }}
          >
            <p className="text-center text-muted-foreground">{t("lock.desc")}</p>
            <div className="flex w-full flex-col gap-3">
              <label htmlFor={id} className="sr-only">
                {t("wallet.walletPassword")}
              </label>
              <div className="[&_.input]:h-11 [&_.input]:text-base">
                <PasswordInput
                  id={id}
                  value={password}
                  onChange={setPassword}
                  autoFocus
                  placeholder={t("wallet.walletPassword")}
                />
              </div>
              {error && <Notice tone="critical">{error}</Notice>}
            </div>
            <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!password || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" />}
              {t("lock.cta")}
            </button>
          </motion.div>
        </form>
      </div>
    </div>
  );
}
