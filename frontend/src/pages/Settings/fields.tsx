import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { useT } from "../../i18n";
import { GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { Panel, Row, Rows, Section } from "../../components/ui/Panel";
import { CopyButton } from "../../components/ui/bits";
import { Drawer } from "../../components/ui/Drawer";

/** Splits an explanation into paragraphs and bullet lists: blocks are separated by blank lines, bullets start with "• ". */
function blocks(text: string): ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] {
  const out: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const para = raw.trim();
    if (!para) continue;
    if (para.startsWith("• ")) {
      const last = out[out.length - 1];
      if (last?.kind === "ul") last.items.push(para.slice(2));
      else out.push({ kind: "ul", items: [para.slice(2)] });
    } else {
      out.push({ kind: "p", text: para });
    }
  }
  return out;
}

/**
 * Explainer is the body of a "Read more" drawer: the setting's short
 * description as a lead, the full explanation arriving paragraph by
 * paragraph as lists do elsewhere in the app, and the parallaxd flag the
 * setting stands for on a card of its own.
 */
function Explainer({ lead, more, flag }: { lead?: ReactNode; more: string; flag?: string }) {
  const t = useT();
  const stagger = useStagger();
  return (
    <motion.div {...stagger} className="flex flex-col gap-4 p-5">
      {lead && (
        <motion.p variants={STAGGER.item} className="text-[15px] font-medium leading-snug text-foreground">
          {lead}
        </motion.p>
      )}
      {blocks(more).map((b, i) =>
        b.kind === "p" ? (
          <motion.p key={i} variants={STAGGER.item} className="leading-relaxed text-foreground/85">
            {b.text}
          </motion.p>
        ) : (
          <motion.ul key={i} variants={STAGGER.item} className="flex flex-col gap-2">
            {b.items.map((item, j) => (
              <li key={j} className="flex gap-2.5 leading-relaxed text-foreground/85">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand" />
                <span>{item}</span>
              </li>
            ))}
          </motion.ul>
        ),
      )}
      {flag && (
        <motion.div variants={STAGGER.item} className="mt-1">
          <Panel className="flex items-center justify-between gap-3 py-2 pr-1.5 pl-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{t("settings.cliFlag")}</span>
              <code className="selectable truncate font-mono text-sm">{flag}</code>
            </div>
            <CopyButton value={flag} />
          </Panel>
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * useReadMore gives a short description a "Read more" link that opens the
 * full explanation in a drawer from the window's right edge.
 */
function useReadMore(title: string, more?: string, flag?: string, lead?: ReactNode) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!more) return { link: null, drawer: null };
  const link = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      className="group ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-brand"
    >
      {t("settings.readMore")}
      <ChevronRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
  const drawer = (
    <Drawer open={open} onClose={() => setOpen(false)} title={title} width="max-w-md">
      <Explainer lead={lead} more={more} flag={flag} />
    </Drawer>
  );
  return { link, drawer };
}

/**
 * Setting is one row of a settings group. Its badge marks a change that
 * waits on a restart: of the node, or of the whole app for the few
 * settings the daemon reads only as its process starts.
 */
export function Setting({
  title,
  desc,
  more,
  flag,
  restart,
  children,
}: {
  title: string;
  desc?: ReactNode;
  /** The full explanation, behind "Read more". */
  more?: string;
  /** The parallaxd flag the setting stands for, shown with the explanation. */
  flag?: string;
  restart?: boolean | "app";
  children: ReactNode;
}) {
  const t = useT();
  const { link, drawer } = useReadMore(title, more, flag, desc);
  return (
    <>
      <Row
        title={title}
        desc={
          desc || link ? (
            <>
              {desc}
              {link}
            </>
          ) : undefined
        }
        badge={
          <AnimatePresence>
            {restart && (
              <motion.span
                className="badge bg-warn/15 text-warn-ink"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={GLIDE}
              >
                <RotateCcw className="size-2.5" />
                {restart === "app" ? t("settings.restartAppBadge") : t("settings.restartBadge")}
              </motion.span>
            )}
          </AnimatePresence>
        }
      >
        {children}
      </Row>
      {drawer}
    </>
  );
}

/**
 * Group is a subsection of a settings page: a heading, a line of context,
 * its rows, and below them the subsection's own Advanced group.
 */
export function Group({
  title,
  desc,
  more,
  className = "",
  children,
}: {
  title: string;
  desc?: ReactNode;
  more?: string;
  className?: string;
  children: ReactNode;
}) {
  const { link, drawer } = useReadMore(title, more, undefined, desc);
  return (
    <Section title={title} className={className}>
      {(desc || link) && (
        <p className="-mt-1 px-1 text-sm text-muted-foreground">
          {desc}
          {link}
        </p>
      )}
      {children}
      {drawer}
    </Section>
  );
}

const ADVANCED_KEY = "parallax-settings-advanced";

function openAdvanced(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ADVANCED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/**
 * Advanced is a section's collapsed group of the daemon's finer options,
 * with a count of those changed from their defaults so a customised node
 * shows it even while closed. Whether it is open is remembered per section.
 */
export function Advanced({ id, changed, children }: { id: string; changed: number; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(() => openAdvanced().has(id));
  const toggle = () => {
    setOpen((o) => {
      try {
        const set = openAdvanced();
        if (o) set.delete(id);
        else set.add(id);
        localStorage.setItem(ADVANCED_KEY, JSON.stringify([...set]));
      } catch {
        /* storage unavailable: the choice lasts this visit */
      }
      return !o;
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-7 items-center gap-1.5 self-start rounded-md px-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING} className="flex">
          <ChevronRight className="size-3.5" />
        </motion.span>
        {t("settings.advanced")}
        {changed > 0 && <span className="badge font-normal">{t("settings.advanced.changed", { n: changed })}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="advanced"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            // Padded so the clip spares the panel's shadow
            className="-m-1 overflow-hidden p-1"
          >
            <Rows>{children}</Rows>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Count is how many of a config's values differ from their defaults (null, "", false, 0, []). */
export function countSet(values: unknown[]): number {
  return values.filter((v) => !(v == null || v === "" || v === false || v === 0 || (Array.isArray(v) && v.length === 0))).length;
}

/**
 * NumberInput edits a whole number. With `optional`, an empty field means
 * the daemon's default (shown as the placeholder) and reads as null.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  unit,
  optional,
  min = 0,
  step,
  width = "w-28",
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string | number;
  unit?: string;
  optional?: boolean;
  min?: number;
  step?: number | "any";
  width?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <input
        type="number"
        inputMode={step === "any" ? "decimal" : "numeric"}
        min={min}
        step={step}
        disabled={disabled}
        className={`input text-right tabular-nums disabled:opacity-50 ${width}`}
        value={value ?? (optional ? "" : 0)}
        placeholder={placeholder === undefined ? undefined : String(placeholder)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return onChange(optional ? null : 0);
          const n = step === "any" ? parseFloat(raw) : parseInt(raw, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      {unit && <span className="min-w-6 text-sm text-muted-foreground">{unit}</span>}
    </>
  );
}

/** TextInput edits a string; empty means the default, shown as the placeholder. */
export function TextInput({
  value,
  onChange,
  placeholder,
  mono = true,
  width = "w-56",
  type = "text",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  width?: string;
  type?: "text" | "password";
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      className={`input disabled:opacity-50 ${mono ? "font-mono text-sm" : ""} ${width}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const split = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * ListInput edits a list as comma- or line-separated text. It keeps its
 * own text while focused, so a trailing separator survives typing, and
 * hands the parsed list up on each change.
 */
export function ListInput({
  value,
  onChange,
  placeholder,
  multiline,
  width = "w-56",
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  placeholder?: string;
  multiline?: boolean;
  width?: string;
}) {
  const joined = (value ?? []).join(multiline ? "\n" : ", ");
  const [text, setText] = useState(joined);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(joined);
  }, [joined, focused]);
  const props = {
    spellCheck: false,
    value: text,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      const list = split(e.target.value);
      onChange(list.length ? list : null);
    },
  };
  return multiline ? (
    <textarea {...props} rows={3} className={`input h-auto resize-y py-1.5 font-mono text-sm ${width}`} />
  ) : (
    <input {...props} className={`input font-mono text-sm ${width}`} />
  );
}
