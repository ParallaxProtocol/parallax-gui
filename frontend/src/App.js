import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
            if (cancelled)
                return;
            setNeedsBootstrap(needs);
            setBootChecked(true);
            if (needs)
                navigate("/onboarding", { replace: true });
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
                if (alive)
                    setAnimationsDisabled(!!c.disableAnimations);
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
        return _jsx(SplashScreen, {});
    }
    if (needsBootstrap) {
        return (_jsxs(Routes, { children: [_jsx(Route, { path: "/onboarding", element: _jsx(Onboarding, { onFinished: () => {
                            setNeedsBootstrap(false);
                            navigate("/", { replace: true });
                        } }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/onboarding", replace: true }) })] }));
    }
    return (_jsx(MotionConfig, { reducedMotion: animationsDisabled ? "always" : "never", transition: animationsDisabled ? { duration: 0 } : undefined, children: _jsxs("div", { className: "flex flex-col h-full", children: [_jsx(TopBar, {}), _jsx(RoutedContent, { animationsDisabled: animationsDisabled }), _jsx(UpdateBanner, {})] }) }));
}
function RoutedContent({ animationsDisabled }) {
    const location = useLocation();
    const routes = (_jsxs(Routes, { location: location, children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/connect", element: _jsx(Connect, {}) }), _jsx(Route, { path: "/mining", element: _jsx(Mining, {}) }), _jsx(Route, { path: "/logs", element: _jsx(Logs, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
    // When animations are disabled, drop the AnimatePresence + motion.div
    // wrapper entirely. Motion's `initial={{ opacity: 0 }}` is committed
    // for one frame even with duration:0, which is what produced the
    // route-transition flicker the user was seeing. Rendering the routes
    // bare avoids that initial paint.
    if (animationsDisabled) {
        return (_jsx("main", { className: "flex-1 overflow-y-auto px-12 py-14", children: routes }));
    }
    return (_jsx("main", { className: "flex-1 overflow-y-auto px-12 py-14", children: _jsx(AnimatePresence, { mode: "wait", children: _jsx(motion.div, { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] }, children: routes }, location.pathname) }) }));
}
function TopBar() {
    const t = useT();
    return (_jsx(motion.header, { className: "shrink-0 border-b border-border bg-bg sticky top-0 z-50", initial: { opacity: 0, y: -12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] }, children: _jsxs("div", { className: "max-w-[1400px] mx-auto px-10 h-20 flex items-center justify-between gap-10", children: [_jsxs("a", { href: "#/", className: "group flex items-center gap-3 transition-opacity hover:opacity-90", children: [_jsx("img", { src: logo, className: "h-9 w-9 transition-transform duration-500 ease-out group-hover:rotate-[8deg]", alt: "Parallax" }), _jsx("span", { className: "text-xl font-medium tracking-tight text-fg", children: "Parallax" })] }), _jsxs("nav", { className: "flex items-center gap-1", children: [_jsx(TopLink, { to: "/", children: t("nav.client") }), _jsx(WalletTopLink, {}), _jsx(TopLink, { to: "/mining", children: t("nav.mining") }), _jsx(TopLink, { to: "/settings", children: t("nav.settings") })] }), _jsx(ClientStatus, {})] }) }));
}
function TopLink({ to, children }) {
    return (_jsx(NavLink, { to: to, end: to === "/", className: ({ isActive }) => `top-nav-link ${isActive ? "top-nav-link-active" : ""}`, children: children }));
}
// WalletTopLink wraps the standard /connect nav link with a small green
// presence dot that lights up whenever a wallet is currently talking to
// our local RPC. The dot is rendered inside the link so click target +
// hover affordance stay identical to the other top-nav entries.
function WalletTopLink() {
    const wallet = useWalletStatus();
    const t = useT();
    return (_jsx(NavLink, { to: "/connect", className: ({ isActive }) => `top-nav-link ${isActive ? "top-nav-link-active" : ""}`, children: _jsxs("span", { className: "inline-flex items-center gap-2", children: [t("nav.wallet"), wallet.connected && (_jsx("span", { className: "live-dot-success", title: t("nav.walletConnected") }))] }) }));
}
function SplashScreen() {
    const t = useT();
    return (_jsx("div", { className: "h-full grid place-items-center", children: _jsxs(motion.div, { className: "text-center", initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] }, children: [_jsx("img", { src: logo, className: "h-20 w-20 mx-auto mb-6", alt: "Parallax" }), _jsx("div", { className: "font-serif text-2xl text-fg", children: "Parallax" }), _jsx("div", { className: "eyebrow mt-2", children: t("splash.loading") })] }) }));
}
