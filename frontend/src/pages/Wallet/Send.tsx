import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowLeft, ArrowRight, BookUser, Check, Loader2, Send as SendIcon, UserPlus } from "lucide-react";
import { api, SendQuote, SentTx, walletError } from "../../lib/api";
import { formatGwei, formatInt, formatUnits, isAddress, parseUnits, sameAddress, shortHex } from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { FADE_OUT, GLIDE } from "../../lib/motion";
import { ContactModal } from "../Contacts/ContactForm";
import { useNode } from "../../lib/live";
import { PAGE } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useT } from "../../i18n";
import { Panel, Property, Rows } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Segmented } from "../../components/ui/Segmented";
import { Address, DrawnCheck, Field, PasswordInput, useSummary } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { Steps } from "./flow";
import { AccountSelect } from "./AccountSelect";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";

const LAX_DECIMALS = 18;
const GWEI_DECIMALS = 9;

type FeeMode = "suggested" | "custom";

/**
 * SendPage moves LAX out of the selected account in three steps: what to
 * send and where, a review of exactly what will be signed (the full
 * recipient, the amount, the fee the node worked out), and the account's
 * password to sign it with. The backend checks every field again before
 * it signs: this page only asks.
 */
export default function SendPage() {
  const t = useT();
  const { info, account } = useWallet();
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [sent, setSent] = useState<SentTx | null>(null);
  // The form keeps what was typed while the review shows. The address book
  // opens it with a contact's address (/send?to=0x…)
  const [params, setParams] = useSearchParams();
  const [to, setTo] = useState(params.get("to") ?? "");
  const [amount, setAmount] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("suggested");
  const [gwei, setGwei] = useState("");

  // Another account selected: start over, nothing carried across
  useEffect(() => {
    setQuote(null);
    setSent(null);
  }, [account?.address]);

  // Sent here again from a contact, while already on this page
  const toParam = params.get("to");
  useEffect(() => {
    if (!toParam) return;
    setTo(toParam);
    setQuote(null);
    setSent(null);
    setParams({}, { replace: true });
  }, [toParam, setParams]);

  if (!info) return null;
  if (!account) {
    return (
      <div className={`p-5 ${PAGE_WIDE}`}>
        <Notice
          tone="info"
          action={
            <Link to="/" className="btn btn-secondary">
              {t("wallet.welcome.cta")}
            </Link>
          }
        >
          {t("wallet.noAccount")}
        </Notice>
      </div>
    );
  }
  const label = accountLabel(account, info.accounts, t);
  const step = sent ? "sent" : quote ? "review" : "form";

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <Steps
          steps={[t("wallet.send.step.details"), t("wallet.send.review"), t("wallet.sent.title")]}
          current={sent ? 3 : quote ? 1 : 0}
        />
      </ToolbarAccessory>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...PAGE}>
          {sent && quote ? (
            <Sent
              tx={sent}
              quote={quote}
              onAgain={() => {
                setSent(null);
                setQuote(null);
                setTo("");
                setAmount("");
              }}
            />
          ) : quote ? (
            <Review quote={quote} label={label} onBack={() => setQuote(null)} onSent={setSent} />
          ) : (
            <SendForm
              from={account.address}
              state={{ to, amount, feeMode, gwei }}
              set={{ setTo, setAmount, setFeeMode, setGwei }}
              onQuote={setQuote}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** The node's readiness to send: why not, or null when it can. */
function useNotReady(): string | null {
  const t = useT();
  const node = useNode();
  if (!node?.running) return t("wallet.err.nodeStopped");
  // The development chain has no peers: it seals what it is sent itself
  if (node.peers === 0 && !node.devChain) return t("wallet.err.noPeers");
  if (node.syncing) return t("wallet.err.syncing");
  return null;
}

function SendForm({
  from,
  state,
  set,
  onQuote,
}: {
  from: string;
  state: { to: string; amount: string; feeMode: FeeMode; gwei: string };
  set: {
    setTo: (v: string) => void;
    setAmount: (v: string) => void;
    setFeeMode: (v: FeeMode) => void;
    setGwei: (v: string) => void;
  };
  onQuote: (q: SendQuote) => void;
}) {
  const t = useT();
  const notReady = useNotReady();
  const { view } = useSummary(from);
  const [busy, setBusy] = useState<"max" | "quote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { to, amount, feeMode, gwei } = state;
  const amountId = useId();

  const toTrim = to.trim();
  const toOk = isAddress(toTrim) && toTrim.startsWith("0x");
  const valueWei = parseUnits(amount, LAX_DECIMALS);
  const priceWei = feeMode === "custom" ? parseUnits(gwei, GWEI_DECIMALS) : null;
  const feeOk = feeMode === "suggested" || (priceWei !== null && priceWei > 0n);
  const ready = !notReady && toOk && valueWei !== null && valueWei > 0n && feeOk;

  const price = () => (feeMode === "custom" && priceWei !== null ? priceWei.toString() : "");

  const max = async () => {
    if (!toOk || !feeOk) return;
    setBusy("max");
    setError(null);
    try {
      const q = await api.walletQuote(from, toTrim, "0", price());
      set.setAmount(formatUnits(q.maxValueWei, LAX_DECIMALS));
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(null);
    }
  };

  const review = async () => {
    if (!ready) return;
    setBusy("quote");
    setError(null);
    try {
      onQuote(await api.walletQuote(from, toTrim, valueWei!.toString(), price()));
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
    >
      {notReady && <Notice tone="info">{notReady}</Notice>}

      {/* The amount, large, as the page's subject */}
      <GlowCard>
        <div className="flex flex-col items-center gap-3 py-4">
          <label htmlFor={amountId} className="text-sm font-medium text-muted-foreground">
            {t("wallet.send.amount")}
          </label>
          <div className="flex max-w-full items-baseline justify-center gap-2.5">
            <input
              id={amountId}
              className="min-w-0 bg-transparent text-center text-6xl font-semibold tracking-tight tabular-nums outline-none placeholder:text-faint"
              style={{ width: `${Math.max(amount.length, 1) + 0.6}ch` }}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => set.setAmount(e.target.value.replace(",", "."))}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="text-3xl font-medium text-muted-foreground">LAX</span>
          </div>
          {amount && valueWei === null ? (
            <span className="text-sm text-critical-ink" role="alert">
              {t("wallet.err.badAmount")}
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm rounded-full px-4"
              onClick={max}
              disabled={!toOk || !!notReady || busy !== null}
            >
              {busy === "max" && <Loader2 className="size-3 animate-spin" />}
              {t("wallet.send.max")}
            </button>
          )}
        </div>
      </GlowCard>

      {/* Where it comes from and goes to, and what the network takes */}
      <Panel className="flex flex-col divide-y divide-border">
        <div className="p-4">
          <Field label={t("wallet.send.from")}>
            {(id) => <AccountSelect id={id} balanceWei={view?.balanceWei || undefined} />}
          </Field>
        </div>
        <div className="p-4">
          <Field
            label={t("wallet.send.to")}
            error={toTrim && !toOk && !looksLikeName(toTrim) ? t("wallet.err.badRecipient") : null}
            hint={<RecipientHint address={toOk ? toTrim : ""} />}
          >
            {(id) => <RecipientInput id={id} value={to} onChange={set.setTo} />}
          </Field>
        </div>
        <div className="p-4">
          <Field
            label={t("wallet.send.fee")}
            hint={feeMode === "suggested" ? t("wallet.send.feeSuggested") : t("wallet.send.feeCustom")}
          >
            {(id) => (
              <div className="flex flex-wrap items-center gap-3">
                <Segmented<FeeMode>
                  options={[
                    { value: "suggested", label: t("wallet.send.feeAuto") },
                    { value: "custom", label: t("wallet.send.feeManual") },
                  ]}
                  value={feeMode}
                  onChange={set.setFeeMode}
                />
                {feeMode === "custom" && (
                  <div className="relative w-40">
                    <input
                      id={id}
                      className="input pr-14 tabular-nums"
                      inputMode="decimal"
                      placeholder="1"
                      value={gwei}
                      onChange={(e) => set.setGwei(e.target.value.replace(",", "."))}
                      aria-label={t("wallet.send.gasPrice")}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
                      gwei
                    </span>
                  </div>
                )}
              </div>
            )}
          </Field>
        </div>
      </Panel>

      {error && <Notice tone="critical">{error}</Notice>}
      <div className="flex justify-center">
        <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!ready || busy !== null}>
          {busy === "quote" && <Loader2 className="size-4 animate-spin" />}
          {t("wallet.send.review")}
          {busy !== "quote" && <ArrowRight className="size-4" />}
        </button>
      </div>
    </form>
  );
}

function Review({
  quote,
  label,
  onBack,
  onSent,
}: {
  quote: SendQuote;
  label: string;
  onBack: () => void;
  onSent: (tx: SentTx) => void;
}) {
  const t = useT();
  const { byAddress } = useContacts();
  const contact = byAddress(quote.to);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPassword(""), []);

  const price = BigInt(quote.gasPriceWei);
  const suggested = BigInt(quote.suggestedPriceWei);
  const dear = suggested > 0n && price > suggested * 3n;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const tx = await api.walletSend({
        from: quote.from,
        to: quote.to,
        valueWei: quote.valueWei,
        gasPriceWei: quote.gasPriceWei,
        gasLimit: quote.gasLimit,
        password,
      });
      setPassword("");
      onSent(tx);
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* What leaves the account, large, and exactly where it goes */}
      <GlowCard>
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-muted-foreground">{t("wallet.review.title")}</span>
            <span className="flex items-baseline gap-2.5">
              <span className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text text-6xl font-semibold tracking-tight text-transparent tabular-nums">
                {formatUnits(quote.valueWei, LAX_DECIMALS)}
              </span>
              <span className="text-3xl font-medium text-muted-foreground">LAX</span>
            </span>
          </div>
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowDown className="size-3.5" />
              {t("wallet.send.to")}
            </span>
            {contact ? (
              // A saved contact: its name is what to recognise, its address a
              // line under it to match against the book
              <span className="flex items-center gap-3.5 rounded-2xl bg-muted px-5 py-3.5">
                <AddressAvatar address={quote.to} size={40} />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate text-2xl font-semibold tracking-tight">{contact.name}</span>
                  <span className="selectable font-mono text-sm text-muted-foreground">{shortHex(quote.to, 10, 8)}</span>
                </span>
              </span>
            ) : (
              <>
                <span className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                  <AddressAvatar address={quote.to} size={28} />
                  <Address value={quote.to} className="text-left text-[15px] leading-relaxed" />
                </span>
                <span className="text-sm text-muted-foreground">{t("wallet.review.checkAddress")}</span>
              </>
            )}
          </div>
        </div>
      </GlowCard>

      <Rows as="dl">
        <Property label={t("wallet.send.from")}>
          <AddressAvatar address={quote.from} size={20} />
          <span className="truncate">{label}</span>
        </Property>
        <Property label={t("wallet.review.fee")}>
          <span>
            {formatUnits(quote.feeWei, LAX_DECIMALS)} LAX
            <span className="ml-2 text-sm text-muted-foreground">
              {t("wallet.review.feeDetail", { gas: formatInt(quote.gasLimit), price: formatGwei(quote.gasPriceWei) })}
            </span>
          </span>
        </Property>
        <Property label={t("wallet.review.total")}>
          <span className="font-semibold text-foreground">{formatUnits(quote.totalWei, LAX_DECIMALS)} LAX</span>
        </Property>
      </Rows>

      {!quote.sufficient && <Notice tone="critical">{t("wallet.err.insufficient")}</Notice>}
      {quote.toSelf && <Notice tone="info">{t("wallet.review.toSelf")}</Notice>}
      {quote.toContract && <Notice tone="warn">{t("wallet.review.toContract")}</Notice>}
      {dear && <Notice tone="warn">{t("wallet.review.dear", { price: formatGwei(quote.suggestedPriceWei) })}</Notice>}

      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && quote.sufficient) send();
        }}
      >
        <Panel className="p-4">
          <Field label={t("wallet.walletPassword")} hint={t("wallet.review.passwordHint")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
          </Field>
        </Panel>
        {error && <Notice tone="critical">{error}</Notice>}
        <div className="flex justify-center gap-3">
          <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-lg min-w-56"
            disabled={busy || !password || !quote.sufficient}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
            {busy ? t("wallet.review.signing") : t("wallet.review.cta")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Sent({ tx, quote, onAgain }: { tx: SentTx; quote: SendQuote; onAgain: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { byAddress } = useContacts();
  const { info } = useWallet();
  const [saving, setSaving] = useState(false);
  const contact = byAddress(quote.to);
  // A new recipient, not one of the wallet's own accounts, can be saved
  const savable = !contact && !quote.toSelf && !info?.accounts.some((a) => sameAddress(a.address, quote.to));
  return (
    <div className="flex flex-col items-center gap-6 pt-6 text-center">
      <span className="scale-150">
        <DrawnCheck />
      </span>
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-3xl font-semibold tracking-tight">{t("wallet.sent.title")}</h2>
        <p className="text-lg">{t("wallet.sent.desc", { amount: formatUnits(quote.valueWei, LAX_DECIMALS) })}</p>
        <p className="max-w-md text-muted-foreground">{t("wallet.sent.wait")}</p>
      </div>
      <Rows as="dl" className="w-full text-left">
        <Property label={t("wallet.sent.hash")} mono>
          <span className="selectable truncate">{tx.hash}</span>
          <CopyButton value={tx.hash} className="-my-1 -mr-2" />
        </Property>
        <Property label={t("wallet.send.to")} mono>
          <span className="selectable truncate">{quote.to}</span>
          {contact && <span className="shrink-0 font-sans text-muted-foreground">{contact.name}</span>}
        </Property>
        <Property label={t("wallet.sent.nonce")}>{formatInt(tx.nonce)}</Property>
      </Rows>
      {savable && (
        <button type="button" className="btn btn-tinted" onClick={() => setSaving(true)}>
          <UserPlus className="size-4" />
          {t("contacts.saveRecipient")}
        </button>
      )}
      <ContactModal open={saving} onClose={() => setSaving(false)} initial={{ address: quote.to }} />
      <div className="flex justify-center gap-3">
        <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onAgain}>
          {t("wallet.sent.again")}
        </button>
        <button type="button" className="btn btn-primary btn-lg min-w-36" onClick={() => navigate("/")}>
          {t("wallet.sent.done")}
        </button>
      </div>
    </div>
  );
}

/** Whether a recipient typed so far is a name to look up, not an address being pasted. */
function looksLikeName(s: string): boolean {
  return !/^0x[0-9a-f]*$/i.test(s);
}

/**
 * RecipientInput is the recipient's address, with the address book to pick
 * from: typing a name, part of an address or a note lists the matching
 * contacts (recently sent to first, then favourites), and the book's button
 * lists them all. Arrow keys move through the list and Enter picks.
 */
function RecipientInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const { contacts } = useContacts();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const all = [...(contacts ?? [])].sort(
      (a, b) => b.lastSentAt - a.lastSentAt || Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name),
    );
    // A complete address needs no suggestions
    if (isAddress(q)) return [];
    if (!q) return all.slice(0, 8);
    return all
      .filter((c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q) || c.note.toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, q]);
  const showing = open && matches.length > 0;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (address: string) => {
    onChange(address);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2">
        <input
          id={id}
          className="input flex-1 font-mono"
          placeholder={(contacts?.length ?? 0) > 0 ? t("wallet.send.toPlaceholder") : "0x…"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(matches[active].address);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
        {(contacts?.length ?? 0) > 0 && (
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={() => setOpen((o) => !o || !!q)}
            aria-label={t("contacts.pick")}
          >
            <BookUser className="size-4" />
            {t("nav.contacts")}
          </button>
        )}
      </div>
      <AnimatePresence>
        {showing && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={t("contacts.pick")}
            className="menu absolute inset-x-0 top-full z-50 mt-1 flex max-h-80 flex-col gap-px overflow-y-auto p-1"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            {matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active ? "" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c.address)}
                  className="menu-item w-full gap-3 py-1.5 text-left"
                >
                  <AddressAvatar address={c.address} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{shortHex(c.address, 10, 8)}</span>
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** RecipientHint names the recipient once a full address is in: a contact, or one of the wallet's own accounts. */
function RecipientHint({ address }: { address: string }) {
  const t = useT();
  const { byAddress } = useContacts();
  const { info } = useWallet();
  if (!address) return <>{t("wallet.send.toHint")}</>;
  const contact = byAddress(address);
  if (contact) {
    return (
      <span className="flex items-center gap-1.5 text-good-ink">
        <Check className="size-3.5" />
        {t("contacts.recipient", { name: contact.name })}
      </span>
    );
  }
  const own = info?.accounts.find((a) => sameAddress(a.address, address));
  if (own && info) return <>{t("contacts.ownAccount", { name: accountLabel(own, info.accounts, t) })}</>;
  return <>{t("wallet.send.toHint")}</>;
}
