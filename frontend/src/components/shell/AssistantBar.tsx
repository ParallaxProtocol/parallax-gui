import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, X } from "lucide-react";
import { useT } from "../../i18n";
import { useAssistant } from "../../lib/assistantContext";
import { NODE_BAR_GAP, NODE_BAR_HEIGHT, useNodeSheet } from "./NodeBar";
import { TOP_BAR_HEIGHT } from "./TopBar";
import { RequestBody } from "./AssistantRequests";
import { activityKey, REQUEST_ICON, requestTitle } from "../../lib/assistantRequests";
import { IconBadge } from "../ui/IconBadge";
import { ActivitySpinner } from "../ui/ActivitySpinner";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { Indicator, type Grade } from "../ui/Indicator";
import { Tooltip } from "../ui/Tooltip";
import { ASSISTANT_GLOW } from "../ui/assistantGlass";
import { CopyButton } from "../ui/bits";
import { DrawnCheck } from "../../pages/Wallet/common";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useContacts } from "../../lib/contacts";
import { formatUnits, sameAddress, shortHex } from "../../lib/format";
import { SENT_MS, type SentInfo } from "../../lib/assistantContext";
import { Ticker } from "../ui/Ticker";
import { api, type AssistantRequest, type MCPActivity, type MCPStatus } from "../../lib/api";
import { BAR_FADE, BAR_GLASS, BAR_SURFACE } from "./barSurface";

/** The node bar's spring, so the two bars move as one. */
const BAR_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;

/**
 * AssistantBar floats beside the node bar, at the window's foot, while AI
 * assistants may connect (Settings › AI assistants): who is connected, at
 * a glance, in the assistants' blue glass. When an assistant asks for
 * something it opens on the request, growing wider and taller and pushing
 * the node bar aside, and closes again once the user has decided. The
 * requests come one at a time, each giving way to the next in place.
 */
export default function AssistantBar() {
  const t = useT();
  const { status, pending, width, activity, restWidth, setHovered, shown, sent } = useAssistant();
  // Pointed at, or focused, the bar opens a little at once; it closes a
  // beat after neither is so, so crossing its edge doesn't flicker it. The
  // two are followed apart: focus leaving (a clicked button giving way to
  // what it did) mustn't count as the pointer leaving. Focus is read from
  // the page rather than kept from its events: a focused button removed
  // with the form it was in (Send giving way to the confirmation) never
  // says it lost focus, and would hold the bar open for good
  const section = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pointer = useRef(false);
  const inside = () => pointer.current || !!section.current?.contains(document.activeElement);
  const hover = (pointed?: boolean) => {
    if (pointed !== undefined) pointer.current = pointed;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(inside()), inside() ? 0 : 250);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // The request shown, or, once a send is carried out, its confirmation
  const req = shown ?? undefined;
  const open = !!req || !!sent;
  // The node's page, opened over the foot, pushes the bar off the window's right edge, unless it is asking something
  const { open: nodeOpen } = useNodeSheet();
  const pushed = nodeOpen && !open;
  // The contents' natural height, which the bar opens to, up to the window
  const inner = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(NODE_BAR_HEIGHT);
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight));
    ro.observe(el);
    setContentHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [width > 0]);

  const maxHeight = vh - TOP_BAR_HEIGHT - 2 * NODE_BAR_GAP;
  // Opened, the bar holds its contents inside its 1px border
  const height = open ? Math.min(Math.max(contentHeight + 2, NODE_BAR_HEIGHT), maxHeight) : NODE_BAR_HEIGHT;

  return (
    <AnimatePresence>
      {width > 0 && (
        <motion.section
          key="assistant-bar"
          aria-label={t("assistant.bar.title")}
          // The node bar's glass, light at rest and thick opened on a request; the blue comes with work and requests
          className={`no-drag fixed z-40 flex flex-col overflow-hidden ${open ? BAR_SURFACE : BAR_GLASS} ${BAR_FADE}`}
          style={{
            right: NODE_BAR_GAP,
            bottom: NODE_BAR_GAP,
            pointerEvents: pushed ? "none" : undefined,
          }}
          initial={{
            opacity: 0,
            y: 16,
            scale: 0.88,
            width,
            height: NODE_BAR_HEIGHT,
            borderRadius: NODE_BAR_HEIGHT / 2,
          }}
          // Fully rounded, as the node bar: a circle or a capsule at rest,
          // opened on a request, the node bar's opened corners
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            x: pushed ? width + 2 * NODE_BAR_GAP : 0,
            width,
            height,
            borderRadius: open ? 16 : NODE_BAR_HEIGHT / 2,
          }}
          exit={{ opacity: 0, y: 16, scale: 0.88 }}
          transition={BAR_SPRING}
          ref={section}
          aria-hidden={pushed || undefined}
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
          onFocusCapture={() => hover()}
          onBlurCapture={() => hover()}
        >
          {/* The assistants' blue, fading in as the bar opens on a request and out as it closes */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ borderRadius: "inherit" }}
            initial={false}
            // A request in full; an assistant at work, a hint of it
            animate={{ opacity: open ? 1 : activity ? 0.45 : 0 }}
            transition={BAR_SPRING}
          >
            {/* The overview card's glow, in the assistants' blue, grown to light the whole bar:
                brightest near its top, still there by the actions at its foot */}
            <div
              className="absolute"
              style={{ left: "-25%", right: "-25%", top: "-60%", height: "200%", background: ASSISTANT_GLOW }}
            />
          </motion.div>
          <div
            className={`relative min-h-0 flex-1 overflow-x-hidden ${open ? "overflow-y-auto" : "overflow-y-hidden"}`}
          >
            {/* Laid out at the bar's coming width, so nothing reflows as it grows */}
            {/* At rest the contents keep their told width, clipped down to the badge */}
            <div ref={inner} style={{ width: open ? width : restWidth }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={sent ? "sent" : req ? req.id : "rest"}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                  }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                >
                  {sent ? (
                    <Sent sent={sent} />
                  ) : req ? (
                    <Opened req={req} more={pending.filter((p) => p.id !== req.id).length} />
                  ) : (
                    <Rest status={status} activity={activity} told={width > 64} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** Rest is the bar between requests: who is connected, or what an assistant is doing, with a way to stop it. */
function Rest({ status, activity, told }: { status: MCPStatus | null; activity: MCPActivity | null; told: boolean }) {
  const t = useT();
  const clients = status?.clients ?? [];
  let grade: Grade = "off";
  let line = t("assistant.bar.starting");
  if (status?.error) {
    grade = "critical";
    line = t("assistant.bar.failed");
  } else if (status?.running && clients.length > 0) {
    grade = "good";
    line =
      clients.length === 1
        ? t("assistant.bar.connected", { name: clients[0] })
        : t("assistant.bar.connectedN", { n: clients.length });
  } else if (status?.running) {
    grade = "info";
    line = t("assistant.bar.ready", { port: new URL(status.url).port });
  }
  // At work: who is doing what, under a spinner
  if (activity) {
    const name = activity.client || t("assistant.bar.anAssistant");
    // A wait says what it awaits; anything else, what it does
    line =
      activity.tool === "wait_for_new_block"
        ? activity.block !== undefined
          ? t("assistant.bar.waitingFor", { name, block: activity.block.toLocaleString() })
          : t("assistant.bar.waitingNext", { name })
        : t("assistant.bar.working", { name, doing: t(activityKey(activity.tool)) });
  }
  const cancel = () => api.mcpCancel().catch(() => {});
  return (
    <div
      // What's up, read out as it changes
      role="status"
      aria-live="polite"
      aria-label={line}
      className="flex items-center gap-3 px-3 text-sm text-muted-foreground"
      style={{ height: NODE_BAR_HEIGHT }}
    >
      {/* The badge and its dot, or, while an assistant works, the activity
          indicator in their place: one gives way to the other on a spring */}
      <span className="relative size-10 shrink-0">
        <AnimatePresence initial={false}>
          {activity ? (
            <motion.span
              key="busy"
              className="absolute inset-0 grid place-items-center"
              // A light blue: the app's blue, eased toward white
              style={{ color: "color-mix(in oklab, var(--info) 55%, white)" }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: SPRING }}
              exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
            >
              <ActivitySpinner size={30} glow label={line} />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: SPRING }}
              exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
            >
              {/* The robot on its own, its dot at its corner */}
              <span className="grid size-full place-items-center">
                <span className="relative">
                  <Bot className="size-6 text-foreground/80" strokeWidth={1.75} aria-hidden />
                  <span className="absolute -right-1.5 -bottom-1 grid place-items-center rounded-full bg-popover p-[2px]">
                    <Indicator grade={grade} ping={grade === "good"} cause={String(clients.length)} />
                  </span>
                </span>
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {/* What's up, fading in as the bar opens to tell it and out as it closes to its badge */}
      <motion.span
        className="flex min-w-0 flex-1 items-center gap-3"
        initial={false}
        animate={{ opacity: told ? 1 : 0 }}
        transition={{ duration: told ? 0.25 : 0.12, delay: told ? 0.08 : 0 }}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold text-foreground">{t("assistant.bar.title")}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={line}
              className={grade === "critical" && !activity ? "text-critical-ink" : ""}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
              exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }}
            >
              {/* A line too long for the bar wraps, and shows a line at a time */}
              <Ticker text={line} />
            </motion.span>
          </AnimatePresence>
        </span>
        {/* While an assistant works, a way to stop it */}
        <AnimatePresence initial={false}>
          {activity && (
            <motion.span
              key="cancel"
              className="shrink-0"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: SPRING }}
              exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
            >
              <Tooltip content={t("assistant.bar.cancel")}>
                <button
                  type="button"
                  className="btn btn-tinted btn-icon"
                  onClick={cancel}
                  aria-label={t("assistant.bar.cancel")}
                >
                  <X className="size-4" />
                </button>
              </Tooltip>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </div>
  );
}

/**
 * Sent is the bar's confirmation of a send an assistant asked for, as the
 * Send page confirms one: the check drawing itself in, what left, where
 * to, and the transaction's hash to copy. From a watch-only account, the
 * signing request it made instead. It closes by itself after a moment.
 */
function Sent({ sent }: { sent: SentInfo }) {
  const t = useT();
  const { showSent, hovered } = useAssistant();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const { tx } = sent;
  const own = info?.accounts.find((a) => sameAddress(a.address, tx.to));
  const toName = own && info ? accountLabel(own, info.accounts, t) : byAddress(tx.to)?.name;
  const amount = formatUnits(tx.valueWei, 18);
  return (
    <div className="flex flex-col items-center px-5 pt-7 pb-5 text-center">
      <span className="scale-125">
        <DrawnCheck />
      </span>
      <motion.div
        className="mt-4 flex flex-col items-center gap-1"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.15 } }}
      >
        <h2 className="text-xl font-semibold tracking-tight">
          {tx.watchOnly ? t("assistant.sent.requestTitle") : t("wallet.sent.title")}
        </h2>
        <p>{tx.watchOnly ? t("assistant.sent.requestDesc", { amount }) : t("wallet.sent.desc", { amount })}</p>
        <p className="text-sm text-muted-foreground">
          {tx.watchOnly ? t("assistant.sent.requestWait") : t("wallet.sent.wait")}
        </p>
      </motion.div>
      <motion.div
        className="mt-4 flex w-full flex-col divide-y divide-border/70 rounded-lg bg-muted/60 text-left text-sm"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.25 } }}
      >
        <div className="flex items-center justify-between gap-4 px-3 py-2.5">
          <span className="shrink-0">{t("wallet.send.to")}</span>
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {toName && <span className="truncate">{toName}</span>}
            <span className="selectable font-mono">{shortHex(tx.to, 8, 6)}</span>
          </span>
        </div>
        {sent.hash && (
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span className="shrink-0">{t("wallet.sent.hash")}</span>
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="selectable truncate font-mono">{shortHex(sent.hash, 10, 8)}</span>
              <CopyButton value={sent.hash} className="-my-1 -mr-2" />
            </span>
          </div>
        )}
      </motion.div>
      {/* Done while it's pointed at. Pointed away from, the button itself
          flattens into a slim bar whose fill runs down the time until the
          card closes; pointed at again, it fills and grows back into Done */}
      <div className="mt-4 grid h-[34px] w-full place-items-center">
        <motion.button
          type="button"
          tabIndex={hovered ? 0 : -1}
          aria-label={hovered ? t("wallet.sent.done") : t("assistant.sent.closing")}
          onClick={() => hovered && showSent(null)}
          className="relative grid w-32 place-items-center overflow-hidden bg-muted font-medium outline-none"
          initial={false}
          animate={{ height: hovered ? 34 : 3, borderRadius: hovered ? 10 : 1.5 }}
          transition={SPRING}
        >
          {/* The button's face, then the countdown's fill */}
          <motion.span
            aria-hidden
            className="absolute inset-0 origin-left"
            style={{
              backgroundColor: hovered ? "var(--brand-fill)" : "color-mix(in oklab, var(--info) 55%, white)",
              backgroundImage: hovered ? "linear-gradient(180deg, var(--gloss-top), var(--gloss-bottom))" : "none",
              transition: "background-color 0.3s ease",
            }}
            initial={false}
            animate={{ scaleX: hovered ? 1 : 0 }}
            transition={hovered ? SPRING : { duration: SENT_MS / 1000, ease: "linear" }}
          />
          <motion.span
            className="relative whitespace-nowrap"
            style={{ color: "var(--brand-foreground)" }}
            initial={false}
            animate={{ opacity: hovered ? 1 : 0, scale: hovered ? 1 : 0.9 }}
            transition={hovered ? { ...SPRING, delay: 0.08 } : FADE_OUT}
          >
            {t("wallet.sent.done")}
          </motion.span>
        </motion.button>
      </div>
    </div>
  );
}

/** Opened is the bar on a request: what it is, and the request to decide. */
function Opened({ req, more }: { req: AssistantRequest; more: number }) {
  const t = useT();
  const Icon = REQUEST_ICON[req.kind];
  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-3 border-b border-info/15 px-4" style={{ height: NODE_BAR_HEIGHT }}>
        <IconBadge icon={Icon} tone="info" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[15px] font-semibold">{requestTitle(req, t)}</h2>
          <span className="truncate text-sm text-muted-foreground">
            {more > 0 ? `${t("assistant.subtitle")} · ${t("assistant.queue", { n: more })}` : t("assistant.subtitle")}
          </span>
        </div>
      </header>
      <RequestBody req={req} />
    </div>
  );
}
