import { useEffect, useId, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Loader2, LockOpen } from "lucide-react";
import { api, walletError } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { BrandMark } from "../ui/BrandMark";
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
    <div className="fixed inset-0 bg-background">
      {/* The window's title bar: draggable, with room for its controls */}
      <div className="drag absolute inset-x-0 top-0 z-10 h-13" />
      <div className="grid h-full place-items-center px-6">
        <motion.form
          className="flex w-full max-w-sm flex-col items-center gap-8"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          onSubmit={(e) => {
            e.preventDefault();
            unlock();
          }}
        >
          <BrandMark size={56} />
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">{t("lock.title")}</h1>
            <p className="text-muted-foreground">{t("lock.desc")}</p>
          </div>
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
        </motion.form>
      </div>
    </div>
  );
}
