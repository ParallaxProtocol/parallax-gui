import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, onEvent, type AssistantRequest, type MCPActivity, type MCPStatus } from "./api";
import { CONFIG_UPDATED_EVENT } from "../App";
import { notify } from "./desktop";
import { useT } from "../i18n";
import { requestTitle, wideRequest } from "./assistantRequests";
import { AssistantContext, SENT_MS, type SentInfo } from "./assistantContext";


/** The least an assistant's activity shows for, so a quick call reads as a beat of work, not a flicker. */
const MIN_ACTIVITY_MS = 600;

/** How often the connected assistants are read while the server runs: they come and go without an event. */
const POLL_MS = 5000;

/** The assistant bar's widths: at rest, and opened on a request (wider for a full address). */
const ASSISTANT_BAR_WIDTH = { compact: 64, rest: 226, restWorking: 272, request: 460, wide: 540 } as const;

/**
 * AssistantProvider follows the AI assistant server (Settings › AI
 * assistants) for the assistant bar and the node bar beside it: whether it
 * runs and who is connected, and the requests waiting on the user, with a
 * desktop notification for one that arrives while the window is in the
 * background. Off on an offline signer, which runs no server.
 */
export function AssistantProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const t = useT();
  const [status, setStatus] = useState<MCPStatus | null>(null);
  const [pending, setPending] = useState<AssistantRequest[]>([]);
  const [vw, setVw] = useState(window.innerWidth);
  const seen = useRef(new Set<string>());
  const [activity, setActivity] = useState<MCPActivity | null>(null);
  const [hovered, setHovered] = useState(false);
  const [holding, setHolding] = useState<AssistantRequest | null>(null);
  const [sent, setSent] = useState<SentInfo | null>(null);
  // The confirmation stays while it's pointed at; once the pointer leaves
  // it, it closes after a moment, unless the pointer comes back first
  useEffect(() => {
    if (!sent || hovered) return;
    const timer = setTimeout(() => setSent(null), SENT_MS);
    return () => clearTimeout(timer);
  }, [sent, hovered]);
  const shown = useRef<{ since: number; on: boolean; clear?: ReturnType<typeof setTimeout> }>({ since: 0, on: false });

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setPending([]);
      return;
    }
    const refresh = () => api.mcpStatus().then(setStatus).catch(() => {});
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    const offStatus = onEvent<MCPStatus>("mcp", setStatus);

    const update = (list: AssistantRequest[]) => {
      setPending(list ?? []);
      const fresh = (list ?? []).filter((r) => !seen.current.has(r.id));
      fresh.forEach((r) => seen.current.add(r.id));
      // Out of sight, the user hears of it on the desktop, as they asked
      if (fresh.length > 0 && !document.hasFocus()) {
        api
          .getConfig()
          .then((c) => c.notifications && notify(t("assistant.notify"), requestTitle(fresh[0], t)))
          .catch(() => {});
      }
    };
    api.assistantRequests().then(update).catch(() => {});
    const offRequests = onEvent<AssistantRequest[]>("assistant-requests", update);

    // An assistant at work: shown at once, and kept a moment at least
    const s = shown.current;
    const offActivity = onEvent<MCPActivity | null>("mcp-activity", (a) => {
      clearTimeout(s.clear);
      if (a) {
        if (!s.on) s.since = Date.now();
        s.on = true;
        setActivity(a);
        return;
      }
      const end = () => {
        s.on = false;
        setActivity(null);
      };
      const left = MIN_ACTIVITY_MS - (Date.now() - s.since);
      if (left > 0) s.clear = setTimeout(end, left);
      else end();
    });
    return () => {
      clearTimeout(s.clear);
      offActivity();
      clearInterval(timer);
      window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
      offStatus();
      offRequests();
    };
  }, [enabled, t]);

  const value = useMemo(() => {
    const working = status?.running ? activity : null;
    // Told what's up: room for the cancel button only while there is work to cancel
    const restWidth = working ? ASSISTANT_BAR_WIDTH.restWorking : ASSISTANT_BAR_WIDTH.rest;
    let width = 0;
    // A confirmation first, then the oldest request, or one being carried out
    const req = sent ? null : (pending[0] ?? holding);
    if (status?.enabled) {
      // At rest just its badge, told what's up when pointed at, wide open
      // on a request
      if (sent) width = ASSISTANT_BAR_WIDTH.wide;
      else if (req) width = wideRequest(req) ? ASSISTANT_BAR_WIDTH.wide : ASSISTANT_BAR_WIDTH.request;
      // Nobody connected and nothing asked: no bar, the node bar has the foot
      else if ((status.clients?.length ?? 0) === 0 && !working) width = 0;
      // Work shows in the badge alone; pointing at it tells more
      else width = hovered ? restWidth : ASSISTANT_BAR_WIDTH.compact;
      // A narrow window keeps room for the node bar
      width = Math.min(width, Math.max(ASSISTANT_BAR_WIDTH.rest, Math.round(vw * 0.55)));
    }
    return { status, pending, width, activity: working, restWidth, hovered, setHovered, shown: req, hold: setHolding, sent, showSent: setSent };
  }, [status, pending, vw, activity, hovered, holding, sent]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

