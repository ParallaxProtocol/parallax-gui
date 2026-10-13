import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { api } from "./lib/api";
import { applyTheme } from "./lib/theme";
import { AnimationsOff } from "./lib/prefs";
import { LiveProvider } from "./lib/live";
import { FADE_OUT } from "./lib/motion";
import Overview from "./pages/Overview";

// The landing page loads with the app; the rest load on first visit, so
// the webview parses less JavaScript before the first paint
const WalletPage = lazy(() => import("./pages/Wallet"));
const Mining = lazy(() => import("./pages/Mining"));
const Settings = lazy(() => import("./pages/Settings"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
import Sidebar from "./components/shell/Sidebar";
import TopBar from "./components/shell/TopBar";
import UpdateBanner from "./components/UpdateBanner";
import { Label } from "./components/ui/Plate";
import { useT } from "./i18n";
import logo from "./assets/logo.svg";

// Custom event the Settings page dispatches whenever it persists a new
// config. App listens for it so globally-applied flags (animations, theme)
// update instantly without a reload, instead of being polled on a timer.
export const CONFIG_UPDATED_EVENT = "parallax:config-updated";

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [animationsDisabled, setAnimationsDisabled] = useState(false);
  const [version, setVersion] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      api
        .bootstrapNeeded()
        .then((needs) => {
          if (cancelled) return;
          setNeedsBootstrap(needs);
          setBootChecked(true);
          if (needs) navigate("/onboarding", { replace: true });
        })
        .catch(() => {
          // Backend not ready yet (dev mode reload): try again shortly
          timer = setTimeout(check, 250);
        });
    };
    check();
    // The backend answers "Parallax Desktop 0.2.3": the sidebar shows just "v0.2.3"
    api
      .version()
      .then((v) => {
        const n = v.replace(/^Parallax Desktop\s*/, "");
        if (!cancelled) setVersion(/^\d/.test(n) ? `v${n}` : n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the globally-applied flags on mount and whenever Settings
  // dispatches a config-updated event.
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api
        .getConfig()
        .then((c) => {
          if (!alive) return;
          setAnimationsDisabled(!!c.disableAnimations);
          applyTheme(c.theme || "system");
        })
        .catch(() => {
          /* backend may not be ready yet */
        });
    };
    refresh();
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
    };
  }, []);

  // The kill switch goes on <body> so the global CSS rule scopes from there,
  // surviving route transitions and onboarding-mode renders.
  useEffect(() => {
    document.body.classList.toggle("no-anim", animationsDisabled);
  }, [animationsDisabled]);

  let content;
  if (!bootChecked) {
    content = <SplashScreen />;
  } else if (needsBootstrap) {
    content = (
      <Suspense fallback={<SplashScreen />}>
        <Routes>
          <Route
            path="/onboarding"
            element={
              <Onboarding
                onFinished={() => {
                  setNeedsBootstrap(false);
                  navigate("/", { replace: true });
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </Suspense>
    );
  } else {
    content = (
      <LiveProvider>
        <div className="flex h-full">
          <Sidebar version={version} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <RoutedContent animationsDisabled={animationsDisabled} />
          </div>
        </div>
        <UpdateBanner />
      </LiveProvider>
    );
  }

  return (
    <AnimationsOff.Provider value={animationsDisabled}>
      <MotionConfig
        reducedMotion={animationsDisabled ? "always" : "never"}
        transition={animationsDisabled ? { duration: 0 } : undefined}
      >
        {content}
      </MotionConfig>
    </AnimationsOff.Provider>
  );
}

function RoutedContent({ animationsDisabled }: { animationsDisabled: boolean }) {
  const location = useLocation();
  // Suspense inside the transition, so a page still loading keeps its slot
  // blank for a moment rather than suspending the whole shell
  const routes = (
    <Suspense fallback={null}>
      <Routes location={location}>
        <Route path="/" element={<Overview />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/mining" element={<Mining />} />
        <Route path="/settings" element={<Settings />} />
        {/* Older routes, from before the redesign */}
        <Route path="/connect" element={<Navigate to="/wallet" replace />} />
        <Route path="/logs" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-10 pt-8 pb-16">
        {animationsDisabled ? (
          // Without animations the wrapper goes entirely: Motion commits
          // `initial` for one frame even at duration 0, which flickered
          routes
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: FADE_OUT }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {routes}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </main>
  );
}

function SplashScreen() {
  const t = useT();
  return (
    <div className="grid h-full place-items-center">
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.img
          src={logo}
          className="mb-6 size-16"
          alt="Parallax"
          animate={{ rotate: [0, 60, 60, 120] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: [0.65, 0, 0.35, 1], times: [0, 0.35, 0.5, 0.85] }}
        />
        <div className="text-2xl font-semibold tracking-tight">Parallax</div>
        <Label className="mt-2">{t("splash.loading")}</Label>
      </motion.div>
    </div>
  );
}
