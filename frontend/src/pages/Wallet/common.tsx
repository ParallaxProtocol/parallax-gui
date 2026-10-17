import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, OctagonAlert, Server } from "lucide-react";
import { api, AddressView } from "../../lib/api";
import { useHiddenFromCapture } from "../../lib/desktop";
import { useNode } from "../../lib/live";
import { useNodeSwitch } from "../../lib/nodeSwitch";
import { CardRow } from "../../components/ui/CardRow";
import { ActivitySpinner } from "../../components/ui/ActivitySpinner";
import { useT } from "../../i18n";
import { Tooltip } from "../../components/ui/Tooltip";
import { GroupedAddress } from "../../components/ui/AccountParts";

/** The shortest password the backend accepts (backend/wallet.go minPasswordLen). */
export const MIN_PASSWORD = 8;

/** Field is a labelled form control with an optional hint or error under it. */
export function Field({
  label,
  hint,
  error,
  aside,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  aside?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {aside}
      </div>
      {children(id)}
      {error ? (
        <span className="text-sm text-critical-ink" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-sm text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

/**
 * PasswordInput is a password box that can show what was typed. Nothing
 * fills it in or remembers it: the browser's autofill and spellcheck are
 * kept off, and the value lives only in the form that owns it.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoFocus,
  isNew,
  placeholder,
  disabled,
  inputRef,
  tall,
  action,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  /** A password being chosen, not one being entered. */
  isNew?: boolean;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  /** As tall as an account picker beside it (AccountSelect), rather than a button. */
  tall?: boolean;
  /** A button at the field's end, past the show toggle: what the password is for (LockScreen's unlock). */
  action?: ReactNode;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useHiddenFromCapture(shown);
  return (
    <div className="relative">
      <input
        id={id}
        ref={inputRef}
        disabled={disabled}
        type={shown ? "text" : "password"}
        className={`input ${action ? "pr-18" : tall ? "h-11 pr-10" : "pr-8"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={isNew ? "new-password" : "off"}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
      />
      <Tooltip content={shown ? t("wallet.password.hide") : t("wallet.password.show")}>
        {/* Out of the tab order: Tab goes from one field to the next */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          className={`btn btn-ghost btn-sm btn-icon absolute inset-y-0 my-auto ${action ? "right-10" : tall ? "right-2" : "right-0.5"}`}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t("wallet.password.hide") : t("wallet.password.show")}
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </Tooltip>
      {action && <div className="absolute inset-y-0 right-1.5 flex items-center">{action}</div>}
    </div>
  );
}

/**
 * NewPassword is the pair of boxes for choosing a password: typed twice,
 * at least MIN_PASSWORD characters. It reports the password once both
 * agree and it is long enough, else "".
 */
export function NewPassword({ onChange, label }: { onChange: (password: string) => void; label?: string }) {
  const t = useT();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const short = a.length > 0 && [...a].length < MIN_PASSWORD;
  const mismatch = b.length > 0 && a !== b;
  useEffect(() => {
    onChange(!short && a.length > 0 && a === b ? a : "");
  }, [a, b, short, onChange]);
  return (
    <>
      <Field
        label={label ?? t("wallet.password.new")}
        hint={t("wallet.password.rule", { n: MIN_PASSWORD })}
        error={short ? t("wallet.err.weakPassword") : null}
      >
        {(id) => <PasswordInput id={id} value={a} onChange={setA} isNew />}
      </Field>
      <Field label={t("wallet.password.confirm")} error={mismatch ? t("wallet.password.mismatch") : null}>
        {(id) => <PasswordInput id={id} value={b} onChange={setB} isNew />}
      </Field>
    </>
  );
}

/**
 * Address shows a full address in groups of four, so it can be checked
 * character by character against what the other party gave: never
 * shortened where money is about to move. It wraps between groups.
 */
export function Address({ value, className = "" }: { value: string; className?: string }) {
  return <GroupedAddress address={value} wrap className={className} />;
}

/**
 * useSummary reads an account's balance and activity from the node, again
 * as the head moves (the backend caches per head) and every few seconds
 * for the pool.
 */
export function useSummary(address: string | undefined) {
  const node = useNode();
  const [view, setView] = useState<AddressView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const running = !!node?.running;
  // While syncing the head moves on every poll: refetch only every few
  // hundred blocks then, so the week-long scan stays off the sync's back
  const head = node?.syncing ? Math.floor(node.currentBlock / 500) : (node?.currentBlock ?? 0);

  useEffect(() => {
    setView(null);
    setErr(null);
  }, [address]);

  useEffect(() => {
    if (!running || !address) return;
    const id = setInterval(() => setTick((n) => n + 1), 6000);
    return () => clearInterval(id);
  }, [running, address]);

  useEffect(() => {
    if (!running || !address) return;
    let alive = true;
    api
      .walletSummary(address)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setErr(null);
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [running, address, head, tick]);

  // Read again now, after something changed what the pool holds
  const refresh = () => setTick((n) => n + 1);
  return { view: running ? view : null, err, running, refresh };
}

/**
 * Checkbox is a checkbox and its label, the box centred on the label's
 * first line however many lines the label wraps to.
 */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <span className="flex h-[1lh] shrink-0 items-center">
        <input
          type="checkbox"
          className="size-3.5 cursor-pointer accent-[var(--brand-fill)]"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** DrawnCheck is a disc in the accent whose check draws itself in. */
export function DrawnCheck() {
  return (
    <motion.span
      className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-fill text-brand-foreground shadow-[0_0_20px_-4px_var(--brand-mark)]"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", bounce: 0.35, visualDuration: 0.45 }}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" aria-hidden>
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
        />
      </svg>
    </motion.span>
  );
}

/** A field flat in its card's row, as in a Mac's settings group: no box of its own, no ring, the caret showing the focus. */
export const FLAT =
  "[&_.input]:border-transparent [&_.input]:bg-transparent [&_.input]:pl-0 [&_.input]:text-base [&_.input]:shadow-none [&_.input:focus]:border-transparent [&_.input:focus]:shadow-none";
/** A one-line field so: as tall as a row. Only its start loses its padding, the end keeping room for its eye. */
export const FLAT_FIELD = `${FLAT} [&_.input]:h-11`;

/** CheckMark is a checkbox's box, as on a Mac: a rounded square that fills and draws its check when ticked. */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-5 shrink-0 place-items-center rounded-md transition-colors duration-200 ${
        checked ? "bg-brand-fill text-brand-foreground" : "border border-border-strong"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none">
        <AnimatePresence initial={false}>
          {checked && (
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={3.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1, transition: { duration: 0.25, ease: "easeOut" } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            />
          )}
        </AnimatePresence>
      </svg>
    </span>
  );
}

/**
 * WalletPasswordPrompt is where a dialog asks for the wallet password
 * before something it guards: a card as a Mac's settings group, the field
 * flat in a row beside its label. For what can't be undone, acknowledge
 * puts a row to tick above it, the field shut (and emptied) until it is
 * ticked and focused as it is; locked shuts it for a gate of the
 * dialog's own (a word typed, a step done).
 */
export function WalletPasswordPrompt({
  value,
  onChange,
  acknowledge,
  locked = false,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  acknowledge?: { label: ReactNode; checked: boolean; onChange: (on: boolean) => void };
  locked?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const shut = locked || (!!acknowledge && !acknowledge.checked);
  const tick = (on: boolean) => {
    acknowledge?.onChange(on);
    if (on) requestAnimationFrame(() => input.current?.focus());
    else onChange("");
  };
  return (
    <div className="glass @container flex flex-col divide-y divide-border overflow-hidden">
      {acknowledge && (
        <button
          type="button"
          role="checkbox"
          aria-checked={acknowledge.checked}
          onClick={() => tick(!acknowledge.checked)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-hover)]"
        >
          <span className="flex h-[1lh] items-center">
            <CheckMark checked={acknowledge.checked} />
          </span>
          <span>{acknowledge.label}</span>
        </button>
      )}
      <div
        className={`flex flex-col gap-1 px-4 pt-3 pb-1 transition-opacity duration-200 @sm:flex-row @sm:items-center @sm:gap-4 @sm:py-1 ${FLAT_FIELD} ${shut ? "opacity-50" : ""}`}
      >
        <label htmlFor={id} className="text-sm @sm:w-36 @sm:shrink-0">
          {t("wallet.walletPassword")}
        </label>
        <div className="min-w-0 flex-1">
          <PasswordInput
            id={id}
            value={value}
            onChange={onChange}
            disabled={shut}
            inputRef={input}
            autoFocus={autoFocus}
            placeholder={t("wallet.password.required")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * NodeOffRow is a card's row while the node is off: what connecting
 * brings (`desc`, or what it brings the wallet), and Connect at its end, the node bar's switch, so the
 * bar and History show it connecting too. Once a start has failed, the
 * row says so, with what the node said under it, and Connect is Try again.
 */
export function NodeOffRow({ desc, inPanel }: { desc?: string; inPanel?: boolean }) {
  const t = useT();
  const { busy, err, toggle, waiting } = useNodeSwitch();
  const failed = !!err && !busy && !waiting;
  return (
    <CardRow
      tone={failed ? "critical" : "info"}
      icon={failed ? OctagonAlert : Server}
      title={failed ? t("wallet.nodeOff.failedTitle") : t("wallet.nodeOff.title")}
      desc={failed ? t("wallet.nodeOff.failedDesc") : (desc ?? t("wallet.nodeOff"))}
      detail={failed ? err : null}
      inPanel={inPanel}
      action={
        <button type="button" className="btn btn-tinted shrink-0" onClick={toggle} disabled={busy || !!waiting}>
          {(busy || waiting) && <ActivitySpinner size={14} />}
          {waiting ?? (busy ? t("node.starting") : failed ? t("wallet.nodeOff.retry") : t("node.start"))}
        </button>
      }
    />
  );
}
