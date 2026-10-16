import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { motion, MotionConfig, MotionGlobalConfig } from "motion/react";
import { Loader2 } from "lucide-react";
import { api } from "./lib/api";
import { applyTheme } from "./lib/theme";
import { LiveProvider } from "./lib/LiveProvider";
import { useWallet } from "./lib/wallet";
import { WalletProvider } from "./lib/WalletProvider";
import { ToolbarSlotProvider } from "./lib/toolbar";
import { DesktopBehaviors } from "./lib/desktop";
import { AnimationsOff, AvatarStyleContext, type AvatarStyle } from "./lib/prefs";
import { usePageSwap } from "./lib/motion";
import WalletPage from "./pages/Wallet";

// The landing page loads with the app; the rest load on first visit, so
// the webview parses less JavaScript before the first paint
const SendPage = lazy(() => import("./pages/Wallet/Send"));
const ReceivePage = lazy(() => import("./pages/Wallet/Receive"));
const ContactsPage = lazy(() => import("./pages/Contacts"));
const SignPage = lazy(() => import("./pages/Offline/Sign"));
const SignMessagePage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.SignMessagePage })));
const VerifyMessagePage = lazy(() => import("./pages/Messages").then((m) => ({ default: m.VerifyMessagePage })));
const SignerHome = lazy(() => import("./pages/Offline/SignerHome"));
const BroadcastPage = lazy(() => import("./pages/Offline/Broadcast"));
const Hello = lazy(() => import("./pages/Hello"));
import Sidebar from "./components/shell/Sidebar";
import { SidebarProvider } from "./lib/SidebarProvider";
import Toolbar from "./components/shell/Toolbar";
import { TOOLBAR_HEIGHT } from "./lib/layout";
import NodeBar, {
  NODE_BAR_ROOM,
  NodeSheetProvider,
  NodeSwitchProvider,
  OfflineBar,
  useNodeSheet,
} from "./components/shell/NodeBar";
import TopBar from "./components/shell/TopBar";
import SettingsSheet, {
  SettingsSheetProvider,
  useSettingsSheet,
  type SettingsPage,
  type SettingsSection,
} from "./components/shell/SettingsSheet";
import { NotificationsProvider } from "./lib/notifications";
import AssistantBar from "./components/shell/AssistantBar";
import { LockGate } from "./components/shell/LockScreen";
import { Arrival } from "./components/shell/Arrival";
import { EmptyWallet } from "./pages/Wallet/Empty";
import { AssistantProvider } from "./lib/assistant";
import { ContactsProvider } from "./lib/ContactsProvider";
import { OfflineMode, useOfflineMode } from "./lib/offline";
import { UpdateProvider } from "./lib/update";
import { useT } from "./i18n";
import { BrandMark } from "./components/ui/BrandMark";

// Custom event the Settings page dispatches whenever it persists a new
// config. App listens for it so globally-applied flags (animations, theme,
// notifications, keeping awake) update instantly without a reload, instead of being polled on a timer.
export const CONFIG_UPDATED_EVENT = "parallax:config-updated";

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  // The greeting shows first on a new install (the node's setup) or while
  // the wallet has no password (a new one, or one with keys from an earlier
  // version), until it is through, for this run of the app
  const [hello, setHello] = useState(false);
  const [existing, setExisting] = useState(false);
  // Whether the greeting just finished: the app then arrives rather than appearing
  const [arrived, setArrived] = useState(false);
  const [animationsDisabled, setAnimationsDisabled] = useState(false);
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>("jazzicon");
  const [desktop, setDesktop] = useState({ notifications: false, preventSleep: false });
  const [offline, setOffline] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      Promise.all([api.bootstrapNeeded(), api.walletInfo().catch(() => null)])
        .then(([needs, info]) => {
          if (cancelled) return;
          setNeedsBootstrap(needs);
          setHello(!!info && !info.hasPassword);
          setExisting(!!info?.needsSetup);
          setBootChecked(true);
        })
        .catch(() => {
          // Backend not ready yet (dev mode reload): try again shortly
          timer = setTimeout(check, 250);
        });
    };
    check();
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
          setAvatarStyle(c.avatarStyle === "blockies" ? "blockies" : "jazzicon");
          setDesktop({ notifications: !!c.notifications, preventSleep: !!c.preventSleep });
          setOffline(!!c.offlineSigner);
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
  } else if (hello || needsBootstrap) {
    content = (
      <Suspense fallback={<SplashScreen />}>
        <Hello
          node={needsBootstrap}
          wallet={hello}
          existing={existing}
          onDone={() => {
            setArrived(true);
            setHello(false);
            setNeedsBootstrap(false);
            navigate("/", { replace: true });
          }}
        />
      </Suspense>
    );
  } else {
    content = (
      <Arrival play={arrived}>
        <LiveProvider>
          <WalletProvider>
            <ContactsProvider>
              <ToolbarSlotProvider>
                <NotificationsProvider>
                  <UpdateProvider>
                    <NodeSheetProvider>
                      <NodeSwitchProvider>
                        <SidebarProvider>
                          <SettingsSheetProvider>
                            <AssistantProvider enabled={!offline}>
                              <DesktopBehaviors {...desktop} />
                              {/* The whole window, behind the lock screen while the wallet is locked */}
                              <LockGate>
                                <Shell offline={offline} animate={!animationsDisabled} />
                              </LockGate>
                            </AssistantProvider>
                          </SettingsSheetProvider>
                        </SidebarProvider>
                      </NodeSwitchProvider>
                    </NodeSheetProvider>
                  </UpdateProvider>
                </NotificationsProvider>
              </ToolbarSlotProvider>
            </ContactsProvider>
          </WalletProvider>
        </LiveProvider>
      </Arrival>
    );
  }

  return (
    <OfflineMode.Provider value={offline}>
      <AnimationsOff.Provider value={animationsDisabled}>
        <AvatarStyleContext.Provider value={avatarStyle}>
          <MotionConfig
            reducedMotion={animationsDisabled ? "always" : "never"}
            transition={animationsDisabled ? { duration: 0 } : undefined}
          >
            {content}
          </MotionConfig>
        </AvatarStyleContext.Provider>
      </AnimationsOff.Provider>
    </OfflineMode.Provider>
  );
}

/**
 * Shell is the window behind the lock screen: the sidebar and the page,
 * running the window's whole height, the node's bar floating over their
 * foot (the sidebar keeps room for it, the page scrolls on beneath it).
 * While the wallet, unlocked, holds no account, it is EmptyWallet's
 * instead, as the greeting's pages, the node's bar still at its foot; the
 * first account brings the app in
 * (Arrival). Settings stays in one place across the change, so a flow in
 * it (a new key's backup, after the key is made) carries on.
 */
function Shell({ offline, animate }: { offline: boolean; animate: boolean }) {
  const { info } = useWallet();
  const empty = !offline && !!info?.hasPassword && !info.locked && info.accounts.length === 0;
  const wasEmpty = useRef(false);
  if (empty) wasEmpty.current = true;
  return (
    <>
      {empty ? (
        <EmptyWallet />
      ) : (
        // Under Settings, which may be open over it as the first account is made
        <Arrival play={wasEmpty.current} coverClassName="z-20">
          <div className="flex h-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              <TopBar />
              <RoutedContent animate={animate} />
            </div>
          </div>
        </Arrival>
      )}
      <SettingsSheet />
      {offline ? <OfflineBar /> : <NodeBar />}
      {!empty && !offline && <AssistantBar />}
    </>
  );
}

function RoutedContent({ animate }: { animate: boolean }) {
  const location = useLocation();
  // An offline signer signs; it has no node to send through or broadcast with
  const offline = useOfflineMode();
  const swap = usePageSwap();
  // Suspense inside the transition, so a page still loading keeps its slot
  // blank for a moment rather than suspending the shell
  const routes = (
    <Suspense fallback={null}>
      <Routes location={location}>
        <Route
          path="/"
          element={
            offline ? (
              <WithPassword>
                <SignerHome />
              </WithPassword>
            ) : (
              <WalletPage />
            )
          }
        />
        <Route
          path="/send"
          element={
            offline ? (
              <Navigate to="/sign" replace />
            ) : (
              <WithPassword>
                <SendPage />
              </WithPassword>
            )
          }
        />
        <Route
          path="/receive"
          element={
            <WithPassword>
              <ReceivePage />
            </WithPassword>
          }
        />
        <Route
          path="/contacts"
          element={
            <WithPassword>
              <ContactsPage />
            </WithPassword>
          }
        />
        <Route path="/accounts" element={<OpenSettings section="accounts" />} />
        {/* Making and importing accounts are Settings' Accounts section's */}
        <Route path="/accounts/new" element={<OpenSettings section="accounts" page={{ kind: "accounts.add" }} />} />
        <Route
          path="/accounts/import"
          element={<OpenSettings section="accounts" page={{ kind: "accounts.import" }} />}
        />
        <Route path="/accounts/watch" element={<OpenSettings section="accounts" page={{ kind: "accounts.watch" }} />} />
        <Route
          path="/messages/sign"
          element={
            <WithPassword>
              <SignMessagePage />
            </WithPassword>
          }
        />
        <Route
          path="/messages/verify"
          element={
            <WithPassword>
              <VerifyMessagePage />
            </WithPassword>
          }
        />
        <Route path="/messages" element={<Navigate to="/messages/sign" replace />} />
        <Route
          path="/sign"
          element={
            <WithPassword>
              <SignPage />
            </WithPassword>
          }
        />
        <Route
          path="/broadcast"
          element={
            offline ? (
              <Navigate to="/" replace />
            ) : (
              <WithPassword>
                <BroadcastPage />
              </WithPassword>
            )
          }
        />
        <Route path="/node" element={<OpenNode />} />
        <Route path="/settings" element={<OpenSettings />} />
        {/* Older routes, from before the redesign */}
        <Route path="/wallet" element={<Navigate to="/" replace />} />
        <Route path="/connect" element={<Navigate to="/" replace />} />
        <Route path="/logs" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    // The scrollbar's gutter is always reserved, so a page growing past the
    // window (or one arriving mid-transition) never shifts the layout sideways.
    // Its foot keeps room for the node's bar, inside the scroller, so a page
    // scrolls on beneath the bar while its end can still scroll clear of it
    <main
      className="relative min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto"
      style={{ paddingBottom: NODE_BAR_ROOM, scrollPaddingTop: TOOLBAR_HEIGHT, scrollPaddingBottom: NODE_BAR_ROOM }}
    >
      {/* The page's title bar, held at the top as the page scrolls on beneath it */}
      <Toolbar />
      {/* The page arriving as it changes. The wrapper stays when animations
          are off, only losing its motion props (Motion would commit `initial`
          for a frame even at duration 0): swapping it out would remount the
          page, losing its state, such as the Settings tab being toggled from.
          It grows with its page, so the room kept for the node's bar follows the
          page's end; a grid, so a page can still fill (or center in) the room
          under the title bar */}
      <motion.div key={location.pathname} className="grid min-h-[calc(100%-3.5rem)]" {...(animate ? swap : {})}>
        {routes}
      </motion.div>
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

/** OpenNode is where /node leads: the node bar, opened into the node's page, over the home page. */
function OpenNode() {
  const { setOpen } = useNodeSheet();
  useEffect(() => setOpen(true), [setOpen]);
  return <Navigate to="/" replace />;
}

/** OpenSettings is where /settings (and /accounts) lead: Settings, opened over the home page. */
function OpenSettings({ section, page }: { section?: SettingsSection; page?: SettingsPage }) {
  const { setOpen, openAt } = useSettingsSheet();
  useEffect(
    () => (section ? openAt(section, page) : setOpen(true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, page?.kind, openAt, setOpen],
  );
  return <Navigate to="/" replace />;
}

/** WithPassword shows a wallet page once the wallet has its password, and Welcome until then. */
function WithPassword({ children }: { children: ReactNode }) {
  const { info } = useWallet();
  if (info && !info.hasPassword) return <Navigate to="/" replace />;
  return <>{children}</>;
}
