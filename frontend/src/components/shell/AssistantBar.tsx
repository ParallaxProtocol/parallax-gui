import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "../../i18n";
import { useAssistant } from "../../lib/assistantContext";
import { NODE_BAR_GAP, NODE_BAR_HEIGHT, useNodeSheet } from "./NodeBar";
import { TOP_BAR_HEIGHT } from "./TopBar";
import { RequestBody } from "./AssistantRequests";
import { activityKey, REQUEST_ICON, requestTitle } from "../../lib/assistantRequests";
import { Fact, Facts } from "../ui/Panel";
import { SparklesSymbol } from "../ui/symbols";
import { ActivitySpinner } from "../ui/ActivitySpinner";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { Indicator, type Grade } from "../ui/Indicator";
import { Tooltip } from "../ui/Tooltip";
import { ASSISTANT_GLOW } from "../ui/assistantGlass";
import { DrawnCheck } from "../../pages/Wallet/common";
import { Hex, Party } from "../../pages/Overview/parts";
import { formatUnits } from "../../lib/format";
import { SENT_MS, type SentInfo } from "../../lib/assistantContext";
import { Ticker } from "../ui/Ticker";
import { api, type AssistantRequest, type MCPActivity, type MCPStatus } from "../../lib/api";
import { BAR_FADE, BAR_GLASS, BAR_SURFACE } from "./barSurface";

/** The node bar's spring, so the two bars move as one. */
const BAR_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;

/**
 * AssistantBar floats beside the node bar, at the window's foot, while AI
 * assistants may connect (Settings › AI assistants): who is connected, at
 * a glance, in the assistants' blue glass: a circle at rest, clicked to
 * open into a capsule saying what's up, the node bar beside it giving way. When an assistant asks for
 * something it opens on the request, growing wider and taller and pushing
 * the node bar aside, and closes again once the user has decided. The
 * requests come one at a time, each giving way to the next in place.
 */
export default function AssistantBar() {
  const t = useT();
  const { status, pending, width, activity, restWidth, setHovered, expanded, setExpanded, shown, sent } =
    useAssistant();
  // Whether the bar is pointed at or focused, which holds a send's
  // confirmation open; it lets go a beat after neither is so, so crossing
  // its edge doesn't flicker it. The two are followed apart: focus leaving
  // (a clicked button giving way to what it did) mustn't count as the
  // pointer leaving. Focus is read from the page rather than kept from its
  // events: a focused button removed with the form it was in (Send giving
  // way to the confirmation) never says it lost focus, and would hold the
  // bar open for good
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

  // What's up, for the badge to announce and the capsule to say
  const rest = useRest(status, activity);
  // Opened into a capsule by a click on its badge: a request taking the
  // bar, or the node's page pushing it away, closes it, as do Escape and a
  // click anywhere else
  const telling = expanded && width > 0 && !open && !pushed;
  useEffect(() => {
    if (open || pushed) setExpanded(false);
  }, [open, pushed, setExpanded]);
  useEffect(() => {
    if (!telling) return;
    const onDown = (e: PointerEvent) => {
      if (!section.current?.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [telling, setExpanded]);

  return (
    <AnimatePresence>
      {width > 0 && (
        <motion.section
          key="assistant-bar"
          aria-label={t("assistant.bar.title")}
          // The node bar's glass, light at rest, lit under the pointer as it opens into a capsule on a click, and thick opened on a request; the blue comes with work and requests
          className={`no-drag fixed z-40 flex flex-col overflow-hidden ${open ? BAR_SURFACE : `${BAR_GLASS} hover:bg-[var(--glass-hover)]`} ${BAR_FADE}`}
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
            {/* At rest the contents keep the capsule's width, clipped down to the badge */}
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
                    <Rest
                      rest={rest}
                      activity={activity}
                      expanded={telling}
                      told={width > NODE_BAR_HEIGHT}
                      onToggle={() => setExpanded((on) => !on)}
                    />
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

type RestState = { grade: Grade; line: string; clients: number };

/** useRest is what's up between requests: who is connected, or what an assistant is doing. */
function useRest(status: MCPStatus | null, activity: MCPActivity | null): RestState {
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
  // At work: who is doing what
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
  return { grade, line, clients: clients.length };
}

/**
 * Rest is the bar between requests. At rest just its badge: the
 * assistants' sparkles, or, while an assistant works, the activity
 * indicator in their place, one giving way to the other on a spring.
 * Clicked, the bar opens into a capsule telling what's up beside it, as
 * the node bar does: the title led by the live dot, the line under it
 * starting where the dot does, and while an assistant works, a way to
 * stop it. A click on the
 * capsule (anywhere but the stop button) closes it again.
 */
function Rest({
  rest,
  activity,
  expanded,
  told,
  onToggle,
}: {
  rest: RestState;
  activity: MCPActivity | null;
  expanded: boolean;
  /** Wide enough to tell what's up: the text fades in as the bar grows to it and out as it shrinks. */
  told: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const stop = () => api.mcpCancel().catch(() => {});
  return (
    <div
      className="flex items-center gap-3 pr-3 text-sm text-muted-foreground"
      style={{ height: NODE_BAR_HEIGHT }}
      onClick={(e) => {
        if (expanded && !(e.target as HTMLElement).closest("button")) onToggle();
      }}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {rest.line}
      </span>
      {/* The badge, a button that opens the capsule and closes it */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={t("assistant.bar.title")}
        className="grid shrink-0 place-items-center pl-3 outline-none"
        style={{ height: NODE_BAR_HEIGHT }}
      >
        <span className="relative size-10">
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
                <ActivitySpinner size={30} glow label={rest.line} />
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                className="absolute inset-0 grid place-items-center"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: SPRING }}
                exit={{ opacity: 0, scale: 0.6, transition: FADE_OUT }}
              >
                {/* Faded by opacity, not a translucent colour, which would show
                    where each star's softening stroke overlaps its fill */}
                <SparklesSymbol className="size-6 text-foreground opacity-80" aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>
      {/* What's up, fading in as the bar opens to tell it and out as it closes to its badge */}
      <motion.span
        className="flex min-w-0 flex-1 items-center gap-3"
        aria-hidden={!told || undefined}
        initial={false}
        animate={{ opacity: told ? 1 : 0 }}
        transition={{ duration: told ? 0.25 : 0.12, delay: told ? 0.08 : 0 }}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Indicator grade={rest.grade} ping={rest.grade === "good"} cause={String(rest.clients)} />
            <span className="truncate text-[15px] font-semibold text-foreground">{t("assistant.bar.title")}</span>
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={rest.line}
              className={rest.grade === "critical" && !activity ? "text-critical-ink" : ""}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
              exit={{ opacity: 0, y: -3, transition: { duration: 0.1 } }}
            >
              {/* A line too long for the capsule wraps, and shows a line at a time */}
              <Ticker text={rest.line} />
            </motion.span>
          </AnimatePresence>
        </span>
        {/* While an assistant works, a way to stop it: the stop square, as
            Apple stops what's running, not a close X */}
        {activity && (
          <Tooltip content={t("assistant.bar.cancel")}>
            <button
              type="button"
              className="btn btn-tinted btn-icon shrink-0"
              onClick={stop}
              tabIndex={told ? undefined : -1}
              aria-label={t("assistant.bar.cancel")}
            >
              <span className="size-2.5 rounded-[2.5px] bg-current" aria-hidden />
            </button>
          </Tooltip>
        )}
      </motion.span>
    </div>
  );
}

/**
 * Sent is the bar's confirmation of a send an assistant asked for, as the
 * Send page confirms one: the check drawing itself in, what left, where
 * to, and the transaction's hash to copy. From a watch-only account, the
 * signing request it made instead. It closes by itself after a moment,
 * the time left running down a hairline along its foot, as a banner times
 * out; pointed at, it waits, the hairline full again.
 */
function Sent({ sent }: { sent: SentInfo }) {
  const t = useT();
  const { showSent, hovered } = useAssistant();
  const { tx } = sent;
  const amount = formatUnits(tx.valueWei, 18);
  return (
    <div className="relative flex flex-col items-center px-5 pt-7 pb-5 text-center">
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
        className="mt-4 w-full text-left"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.25 } }}
      >
        <Facts>
          <Fact label={t("wallet.send.to")}>
            <Party address={tx.to} />
          </Fact>
          {sent.hash && (
            <Fact label={t("wallet.sent.hash")}>
              <Hex value={sent.hash} />
            </Fact>
          )}
        </Facts>
      </motion.div>
      <button type="button" className="btn btn-primary mt-4 w-32" onClick={() => showSent(null)}>
        {t("wallet.sent.done")}
      </button>
      {/* The time left, running down from the right */}
      <motion.span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left"
        style={{ backgroundColor: "color-mix(in oklab, var(--info) 55%, white)" }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: hovered ? 1 : 0 }}
        transition={hovered ? SPRING : { duration: SENT_MS / 1000, ease: "linear" }}
      />
    </div>
  );
}

/** Opened is the bar on a request: what it is, and the request to decide. */
function Opened({ req, more }: { req: AssistantRequest; more: number }) {
  const t = useT();
  const Icon = REQUEST_ICON[req.kind];
  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-3 border-b border-info/15 pr-4 pl-5" style={{ height: NODE_BAR_HEIGHT }}>
        {/* Its symbol bare, as a sheet leads with one, in the assistants' blue */}
        <Icon className="size-5 shrink-0 text-info-ink" strokeWidth={2} aria-hidden />
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
