import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig, MotionGlobalConfig } from "motion/react";
import { Loader2 } from "lucide-react";
import { api } from "./lib/api";
import { applyTheme } from "./lib/theme";
import { LiveProvider } from "./lib/live";
import { DesktopBehaviors } from "./lib/desktop";
import { AnimationsOff } from "./lib/prefs";
import { PAGE } from "./lib/motion";
import Overview from "./pages/Overview";

// The landing page loads with the app; the rest load on first visit, so
// the webview parses less JavaScript before the first paint
const WalletPage = lazy(() => import("./pages/Wallet"));
const Settings = lazy(() => import("./pages/Settings"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
import Sidebar from "./components/shell/Sidebar";
import Toolbar from "./components/shell/Toolbar";
import StatusBar from "./components/shell/StatusBar";
import UpdateBanner from "./components/UpdateBanner";
import { useT } from "./i18n";
import { BrandMark } from "./components/ui/BrandMark";

// Custom event the Settings page dispatches whenever it persists a new
// config. App listens for it so globally-applied flags (animations, theme,
// notifications, keeping awake) update instantly without a reload, instead of being polled on a timer.
export const CONFIG_UPDATED_EVENT = "parallax:config-updated";

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [animationsDisabled, setAnimationsDisabled] = useState(false);
  const [desktop, setDesktop] = useState({ notifications: false, preventSleep: false });
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
    // The backend answers "Parallax Desktop 0.2.3": the status bar shows just "v0.2.3"
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
          setDesktop({ notifications: !!c.notifications, preventSleep: !!c.preventSleep });
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
  // Motion's own switch as well: components pass their own transitions,
  // which a MotionConfig default alone doesn't override
  useEffect(() => {
    document.body.classList.toggle("no-anim", animationsDisabled);
    MotionGlobalConfig.skipAnimations = animationsDisabled;
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
        <DesktopBehaviors {...desktop} />
        <div className="flex h-full flex-col">
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              <Toolbar />
              <RoutedContent animate={!animationsDisabled} />
            </div>
          </div>
          <StatusBar version={version} />
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

function RoutedContent({ animate }: { animate: boolean }) {
  const location = useLocation();
  // Suspense inside the transition, so a page still loading keeps its slot
  // blank for a moment rather than suspending the shell
  const routes = (
    <Suspense fallback={null}>
      <Routes location={location}>
        <Route path="/" element={<Overview />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/settings" element={<Settings />} />
        {/* Older routes, from before the redesign */}
        <Route path="/connect" element={<Navigate to="/wallet" replace />} />
        <Route path="/logs" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    // The scrollbar's gutter is always reserved, so a page growing past the
    // window (or one arriving mid-transition) never shifts the layout sideways
    <main className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
      {/* A quick crossfade between pages. The wrapper stays when animations
          are off, only losing its motion props (Motion would commit `initial`
          for a frame even at duration 0): swapping it out would remount the
          page, losing its state, such as the Settings tab being toggled from */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={location.pathname} className="h-full" {...(animate ? PAGE : {})}>
          {routes}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function SplashScreen() {
  const t = useT();
  return (
    <div className="drag grid h-full place-items-center">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <BrandMark size={56} />
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("splash.loading")}
        </span>
      </motion.div>
    </div>
  );
}
