import { useEffect, useId, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api, AddressView } from "../../lib/api";
import { useNode } from "../../lib/live";
import { useT } from "../../i18n";
import { Tooltip } from "../../components/ui/Tooltip";

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
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  /** A password being chosen, not one being entered. */
  isNew?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? "text" : "password"}
        className="input pr-8"
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
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon absolute top-0.5 right-0.5"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t("wallet.password.hide") : t("wallet.password.show")}
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </Tooltip>
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
 * shortened where money is about to move.
 */
export function Address({ value, className = "" }: { value: string; className?: string }) {
  const body = value.startsWith("0x") ? value.slice(2) : value;
  const groups = body.match(/.{1,4}/g) ?? [];
  return (
    <span className={`selectable font-mono break-all ${className}`}>
      <span className="text-muted-foreground">0x</span>
      {groups.map((g, i) => (
        <span key={i} className={i % 2 ? "text-foreground/75" : ""}>
          {g}
          {i < groups.length - 1 && <span className="inline-block w-[0.3em]" />}
        </span>
      ))}
    </span>
  );
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

  return { view: running ? view : null, err, running };
}
