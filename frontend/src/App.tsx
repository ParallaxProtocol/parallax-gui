import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { api } from "./lib/api";
import Dashboard from "./pages/Dashboard";
import Connect from "./pages/Connect";
import Mining from "./pages/Mining";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import Onboarding from "./pages/Onboarding";
import ClientStatus from "./components/ClientStatus";
import UpdateBanner from "./components/UpdateBanner";
import { useWalletStatus } from "./lib/useWalletStatus";
import { useT } from "./i18n";
import logo from "./assets/logo.svg";

// Custom event the Settings page dispatches whenever it persists a new
// config. App listens for it so the disable-animations flag (and any
// other globally-applied config flag) updates instantly without a
// reload, instead of being polled on a timer.
export const CONFIG_UPDATED_EVENT = "parallax:config-updated";

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [animationsDisabled, setAnimationsDisabled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .bootstrapNeeded()
      .then((needs) => {
        if (cancelled) return;
        setNeedsBootstrap(needs);
        setBootChecked(true);
        if (needs) navigate("/onboarding", { replace: true });
      })
      .catch(() => {
        // Backend not yet ready (dev mode reload). Try again shortly.
        setTimeout(() => setBootChecked(false), 250);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the disable-animations flag on mount and whenever Settings
  // dispatches a config-updated event.
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api
        .getConfig()
        .then((c) => {
          if (alive) setAnimationsDisabled(!!c.disableAnimations);
        })
        .catch(() => {
          /* ignore — backend may not be ready yet */
        });
    };
    refresh();
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    return () => {
      alive = false;
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
    };
  }, []);

  // Apply the kill switch to <body> so the global CSS rule scopes from
  // there. Using <body> rather than the React root means it survives
  // route transitions and onboarding-mode renders.
  useEffect(() => {
    document.body.classList.toggle("no-anim", animationsDisabled);
  }, [animationsDisabled]);

  if (!bootChecked) {
    return <SplashScreen />;
  }

  if (needsBootstrap) {
    return (
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
    );
  }

  return (
    <MotionConfig
      reducedMotion={animationsDisabled ? "always" : "never"}
      transition={animationsDisabled ? { duration: 0 } : undefined}
    >
      <div className="flex flex-col h-full">
        <TopBar />
        <RoutedContent animationsDisabled={animationsDisabled} />
        <UpdateBanner />
      </div>
    </MotionConfig>
  );
}

function RoutedContent({ animationsDisabled }: { animationsDisabled: boolean }) {
  const location = useLocation();
  const routes = (
    <Routes location={location}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/connect" element={<Connect />} />
      <Route path="/mining" element={<Mining />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  // When animations are disabled, drop the AnimatePresence + motion.div
  // wrapper entirely. Motion's `initial={{ opacity: 0 }}` is committed
  // for one frame even with duration:0, which is what produced the
  // route-transition flicker the user was seeing. Rendering the routes
  // bare avoids that initial paint.
  if (animationsDisabled) {
    return (
      <main className="flex-1 overflow-y-auto px-12 py-14">{routes}</main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto px-12 py-14">
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {routes}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function TopBar() {
  const t = useT();
  return (
    <motion.header
      className="shrink-0 border-b border-border bg-bg sticky top-0 z-50"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="max-w-[1400px] mx-auto px-10 h-20 flex items-center justify-between gap-10">
        {/* Brand */}
        <a
          href="#/"
          className="group flex items-center gap-3 transition-opacity hover:opacity-90"
        >
          <img
            src={logo}
            className="h-9 w-9 transition-transform duration-500 ease-out group-hover:rotate-[8deg]"
            alt="Parallax"
          />
          <span className="text-xl font-medium tracking-tight text-fg">
            Parallax
          </span>
        </a>

        {/* Centered nav */}
        <nav className="flex items-center gap-1">
          <TopLink to="/">{t("nav.client")}</TopLink>
          <WalletTopLink />
          <TopLink to="/mining">{t("nav.mining")}</TopLink>
          <TopLink to="/settings">{t("nav.settings")}</TopLink>
        </nav>

        {/* Right-side live client status */}
        <ClientStatus />
      </div>
    </motion.header>
  );
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `top-nav-link ${isActive ? "top-nav-link-active" : ""}`
      }
    >
      {children}
    </NavLink>
  );
}

// WalletTopLink wraps the standard /connect nav link with a small green
// presence dot that lights up whenever a wallet is currently talking to
// our local RPC. The dot is rendered inside the link so click target +
// hover affordance stay identical to the other top-nav entries.
function WalletTopLink() {
  const wallet = useWalletStatus();
  const t = useT();
  return (
    <NavLink
      to="/connect"
      className={({ isActive }) =>
        `top-nav-link ${isActive ? "top-nav-link-active" : ""}`
      }
    >
      <span className="inline-flex items-center gap-2">
        {t("nav.wallet")}
        {wallet.connected && (
          <span
            className="live-dot-success"
            title={t("nav.walletConnected")}
          />
        )}
      </span>
    </NavLink>
  );
}

function SplashScreen() {
  const t = useT();
  return (
    <div className="h-full grid place-items-center">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <img src={logo} className="h-20 w-20 mx-auto mb-6" alt="Parallax" />
        <div className="font-serif text-2xl text-fg">Parallax</div>
        <div className="eyebrow mt-2">{t("splash.loading")}</div>
      </motion.div>
    </div>
  );
}
