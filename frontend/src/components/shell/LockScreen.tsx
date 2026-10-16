import { useCallback, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { api, walletError } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useAnimationsOff } from "../../lib/prefs";
import { useT } from "../../i18n";
import { EASE, Glow } from "../ui/Glow";
import logo from "../../assets/logo.svg";
import { Tooltip } from "../ui/Tooltip";
import { PasswordInput } from "../../pages/Wallet/common";

/** When, in ms, the lock's shackle drops shut, and when the lock rises to its place on the screen. */
const SHUT_MS = 650;
const INTRO_MS = 1450;
/** How long, in ms after the lock has risen, "Wallet locked" stays before giving way to the app's name. */
const NAME_MS = 1000;

/** The lock and the screen's mark above the title are one, which glides from the one to the other. */
const MARK = "lock-mark";
const MORPH = { duration: 0.65, ease: EASE };

/** How the mark changes between the lock and the logo, in time with the title's words. */
const SWAP_IN = { opacity: 0, scale: 1.15, filter: "blur(8px)" };
const SWAPPED = {
  opacity: 1,
  scale: 1,
  filter: "blur(0px)",
  transition: { delay: 0.2, duration: 0.55, ease: EASE },
};
const SWAP_OUT = {
  opacity: 0,
  scale: 0.85,
  filter: "blur(6px)",
  transition: { duration: 0.3, ease: "easeIn" },
} as const;

/**
 * How long, in ms, the window can be out of focus before the lock screen
 * puts its form away again and shows only the app's name: longer when a
 * password has been begun in it.
 */
const AWAY_MS = 10_000;
const AWAY_TYPED_MS = 30_000;

/** The app's name, which isn't translated. */
const APP_NAME = "Parallax Wallet";

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
  // The lock shuts itself only when the wallet locks while the app is open: launched locked, the screen is simply there
  const opened = useRef(false);
  useEffect(() => {
    if (unlocked) opened.current = true;
  }, [unlocked]);

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
  if (locked) return <LockScreen shutting={opened.current} />;
  return <>{children}</>;
}

/**
 * LockScreen shows the app's name, and asks for the wallet password once
 * the user starts typing it: the first key brings the form in, and goes in
 * the field. Away from the window a while, it shows only the name again.
 * Shutting, it first plays the lock shutting itself and lands on "Wallet
 * locked"; otherwise it opens on the name, which soon gives way to the form
 * by itself, and the form stays out.
 */
function LockScreen({ shutting }: { shutting: boolean }) {
  const t = useT();
  const { refresh } = useWallet();
  const id = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // First the lock alone, on black, shutting itself; then the screen
  const animationsOff = useAnimationsOff();
  const [intro, setIntro] = useState(shutting && !animationsOff);
  // The lock lands on "Wallet locked", which soon gives way to the app's name
  const [named, setNamed] = useState(!intro);
  useEffect(() => {
    if (intro || named) return;
    const id = setTimeout(() => setNamed(true), NAME_MS);
    return () => clearTimeout(id);
  }, [intro, named]);
  // Whether the form is out: typing brings it, being away puts it back; launched locked, it comes by itself and stays
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (shutting) return;
    const id = setTimeout(() => setOpen(true), NAME_MS);
    return () => clearTimeout(id);
  }, [shutting]);
  const away = useAway(password ? AWAY_TYPED_MS : AWAY_MS);
  // Only the title's first entrance waits for the lock to rise
  const settled = useRef(false);
  useEffect(() => {
    if (!intro) settled.current = true;
  }, [intro]);
  // What the title says, and the mark shows: the lock, or the app's name
  const locked = open || !named;
  useEffect(() => () => setPassword(""), []);
  useEffect(() => {
    if (!away || !shutting) return;
    setOpen(false);
    setPassword("");
    setError(null);
  }, [away, shutting]);
  useEffect(() => {
    if (intro || open) return;
    const type = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      // The key goes in the field, not wherever the focus lands as it comes in
      e.preventDefault();
      setPassword(e.key);
      setOpen(true);
    };
    window.addEventListener("keydown", type);
    return () => window.removeEventListener("keydown", type);
  }, [intro, open]);
  // The field comes in focused, with the caret after the key that brought it
  const input = useRef<HTMLInputElement | null>(null);
  const field = useCallback((el: HTMLInputElement | null) => {
    input.current = el;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    if (!intro) return;
    const id = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(id);
  }, [intro]);

  const [box, shake] = useAnimate<HTMLDivElement>();
  // The field is disabled while the password is tried, which takes its focus: it gets it back after
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.walletUnlock(password);
      setPassword("");
      await refresh();
    } catch (e) {
      // As a Mac's login does: the field shakes, empties, and is ready for another try
      setError(walletError(e, t));
      setPassword("");
      shake(box.current, { x: [0, -12, 11, -9, 7, -4, 2, 0] }, { duration: 0.5, ease: "easeOut" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/* The window's title bar: draggable, with room for its controls */}
      <div className="drag absolute inset-x-0 top-0 z-30 h-13" />
      <AnimatePresence>
        {intro && (
          <motion.div
            key="black"
            className="absolute inset-0 z-20 bg-black"
            exit={{ opacity: 0, transition: { duration: 0.55, ease: "easeInOut" } }}
          />
        )}
        {intro && (
          <div key="lock" className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
            <ShuttingLock />
          </div>
        )}
      </AnimatePresence>
      {!intro && <Glow />}
      {!intro && (
        <div className="relative grid h-full place-items-center px-6">
          <form
            className="flex w-full max-w-sm flex-col items-center gap-10"
            onSubmit={(e) => {
              e.preventDefault();
              unlock();
            }}
          >
            {/* The lock rises above "Wallet locked", which soon gives way to the name; typing brings the title back, and the form */}
            <motion.div layout="position" transition={MORPH} className="flex flex-col items-center gap-6">
              {/* The mark goes with the title: the lock with "Wallet locked", the logo with the name */}
              <motion.div layoutId={MARK} transition={MORPH} className="relative size-20">
                <AnimatePresence initial={false}>
                  {locked ? (
                    <motion.div
                      key="lock"
                      className="absolute inset-0 text-foreground"
                      initial={SWAP_IN}
                      animate={SWAPPED}
                      exit={SWAP_OUT}
                    >
                      <LockGlyph shut className="size-full overflow-visible" />
                    </motion.div>
                  ) : (
                    <motion.span
                      key="logo"
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)]"
                      style={{
                        mask: `url("${logo}") center / contain no-repeat`,
                        WebkitMask: `url("${logo}") center / contain no-repeat`,
                      }}
                      initial={SWAP_IN}
                      animate={SWAPPED}
                      exit={SWAP_OUT}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.h1
                  key={locked ? "locked" : "name"}
                  className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text px-2 pb-1 text-center text-5xl font-semibold tracking-tight text-transparent"
                  initial={{ opacity: 0, y: settled.current ? 14 : 24, filter: "blur(10px)" }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    transition: { delay: settled.current ? 0 : 0.15, duration: 0.6, ease: EASE },
                  }}
                  exit={{ opacity: 0, y: -14, filter: "blur(10px)", transition: { duration: 0.3, ease: "easeIn" } }}
                >
                  {locked ? t(shutting ? "lock.title" : "lock.unlockTitle") : APP_NAME}
                </motion.h1>
              </AnimatePresence>
            </motion.div>
            <AnimatePresence>
              {open && (
                <motion.div
                  className="flex w-full flex-col items-center gap-6"
                  initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    filter: "blur(0px)",
                    transition: { delay: 0.25, duration: 0.5, ease: EASE },
                  }}
                  exit={{ opacity: 0, y: 10, filter: "blur(6px)", transition: { duration: 0.3, ease: "easeIn" } }}
                >
                  <p className="text-center text-muted-foreground">{t("lock.desc")}</p>
                  <div className="flex w-full flex-col gap-3">
                    <label htmlFor={id} className="sr-only">
                      {t("wallet.walletPassword")}
                    </label>
                    <div
                      ref={box}
                      className={`[&_.input]:h-11 [&_.input]:text-base ${error ? "[&_.input]:shadow-[0_0_0_1px_var(--critical)]" : ""}`}
                    >
                      <PasswordInput
                        id={id}
                        value={password}
                        onChange={(v) => {
                          setPassword(v);
                          setError(null);
                        }}
                        inputRef={field}
                        disabled={busy}
                        action={
                          <Tooltip content={t("lock.cta")}>
                            <button
                              type="submit"
                              className="btn btn-tinted btn-sm btn-icon size-8"
                              disabled={!password || busy}
                              aria-label={t("lock.cta")}
                            >
                              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                            </button>
                          </Tooltip>
                        }
                        placeholder={t("wallet.walletPassword")}
                      />
                    </div>
                    <AnimatePresence>
                      {error && (
                        <motion.p
                          role="alert"
                          className="text-center text-sm text-critical-ink"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } }}
                          exit={{ opacity: 0, transition: { duration: 0.2 } }}
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * useAway says whether the window has been out of focus for at least ms,
 * and goes back to false as soon as it has the focus again.
 */
function useAway(ms: number) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blur = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setAway(true), ms);
    };
    const focus = () => {
      clearTimeout(timer);
      setAway(false);
    };
    if (!document.hasFocus()) blur();
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [ms]);
  return away;
}

/**
 * ShuttingLock is a big, solid padlock in the welcome's gradient: it rises
 * out of a blur with its shackle up, the shackle springs down shut, the lock
 * gives under it and a ring of light goes out from it, and then it rises to
 * the screen's mark (MARK).
 */
function ShuttingLock() {
  const [shut, setShut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShut(true), SHUT_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div aria-hidden className="relative grid place-items-center">
      {/* A soft light behind the lock, which flares as it shuts */}
      <motion.span
        className="absolute size-80 rounded-full blur-2xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--app-brand) 45%, transparent), transparent)",
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.6, ease: EASE } }}
        animate={shut ? { opacity: [0.5, 0.95, 0.6], scale: [0.9, 1.15, 1] } : { opacity: 0.5, scale: 0.9 }}
        transition={shut ? { duration: 0.7, ease: EASE, times: [0, 0.2, 1] } : { duration: 0.6, ease: EASE }}
      />
      {/* The ring of light that goes out as it shuts */}
      {shut && (
        <motion.span
          className="absolute size-40 rounded-full border border-white/40"
          initial={{ opacity: 0.7, scale: 0.7 }}
          animate={{ opacity: 0, scale: 2.2 }}
          transition={{ delay: 0.05, duration: 0.75, ease: EASE }}
        />
      )}
      <motion.div
        layoutId={MARK}
        transition={MORPH}
        className="relative size-36"
        exit={{ filter: "blur(8px)", transition: MORPH }}
      >
        <LockGlyph
          shut={shut}
          className="size-full overflow-visible text-white drop-shadow-[0_12px_40px_rgba(177,140,255,0.35)]"
          initial={{ opacity: 0, scale: 0.8, y: 12, filter: "blur(14px)" }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.55, ease: EASE }}
        />
      </motion.div>
    </div>
  );
}

/**
 * LockGlyph is the solid padlock, in a gradient from the text colour into
 * the brand's violet, with its keyhole cut through. Open, its shackle stands
 * up; shut, it springs down into the body, which gives a little under it.
 */
function LockGlyph({ shut, ...props }: { shut: boolean } & ComponentProps<typeof motion.svg>) {
  // SVG references want ids without React's colons
  const uid = useId().replace(/:/g, "");
  const fill = `${uid}-fill`;
  const hole = `${uid}-hole`;
  return (
    <motion.svg aria-hidden viewBox="0 0 64 64" {...props}>
      <defs>
        <linearGradient id={fill} x1="8" y1="4" x2="56" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="0.5" style={{ stopColor: "color-mix(in oklab, currentColor 94%, var(--app-brand))" }} />
          <stop offset="1" style={{ stopColor: "var(--app-brand)" }} />
        </linearGradient>
        {/* The keyhole, cut through the body */}
        <mask id={hole}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="32" cy="41.5" r="3.5" fill="#000" />
          <rect x="30.5" y="42" width="3" height="7" rx="1.5" fill="#000" />
        </mask>
      </defs>
      {/* The shackle: up, open, until it springs shut into the body */}
      <motion.path
        d="M20 34V24a12 12 0 0 1 24 0v10"
        fill="none"
        stroke={`url(#${fill})`}
        strokeWidth="6"
        strokeLinecap="round"
        initial={{ y: shut ? 0 : -8 }}
        animate={{ y: shut ? 0 : -8 }}
        transition={{ type: "spring", stiffness: 900, damping: 26, mass: 0.5 }}
      />
      {/* The body, which gives a little as the shackle lands */}
      <motion.g
        initial={false}
        animate={shut ? { y: [0, 1.4, 0], scaleY: [1, 0.97, 1] } : { y: 0 }}
        transition={{ delay: 0.05, duration: 0.26, ease: "easeOut" }}
        style={{ originY: 1 }}
      >
        <rect x="8" y="30" width="48" height="26" rx="8" fill={`url(#${fill})`} mask={`url(#${hole})`} />
      </motion.g>
    </motion.svg>
  );
}
