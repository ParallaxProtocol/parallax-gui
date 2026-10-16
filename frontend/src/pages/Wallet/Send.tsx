import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookUser,
  Check,
  Loader2,
  QrCode,
  ScanLine,
  Send as SendIcon,
  X,
} from "lucide-react";
import { api, SendQuote, SentTx, SigningRequest, walletError, type AddressView } from "../../lib/api";
import {
  formatGwei,
  formatInt,
  formatPercent,
  formatUnits,
  isAddress,
  parseUnits,
  sameAddress,
  shortHex,
} from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { FADE_IN, FADE_OUT, POPUP, POPUP_ROW, POPUP_ROWS, SPRING, useStagger } from "../../lib/motion";
import { DocCard } from "../../components/offline/parts";
import { docFileName } from "../../lib/offline";
import { BroadcastFlow } from "../Offline/Broadcast";
import { syncProgress, useNode } from "../../lib/live";
import { useNodeSwitch } from "../../lib/nodeSwitch";
import { PAGE } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useAgo, useT } from "../../i18n";
import { Panel, Property, Rows } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Segmented } from "../../components/ui/Segmented";
import { Pill } from "../../components/ui/Pill";
import { Address, DrawnCheck, Field, useSummary } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { Steps } from "./flow";
import { AccountSelect } from "./AccountSelect";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { GroupedAddress, ShortAddress } from "../../components/ui/AccountParts";
import { usePopup } from "../../components/ui/popup";
import { Tooltip } from "../../components/ui/Tooltip";

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
  // A watch-only account's send: its signing request, then scanning back
  // the transaction the offline signer made of it
  const [request, setRequest] = useState<SigningRequest | null>(null);
  const [scanning, setScanning] = useState(false);
  // The form keeps what was typed while the review shows. The contacts page
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
    setRequest(null);
    setScanning(false);
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
            <Link to="/" className="btn btn-tinted">
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
  const watch = account.watchOnly;
  const step = sent ? "sent" : scanning ? "scan" : request ? "request" : quote ? "review" : "form";
  const steps = watch
    ? [
        t("wallet.send.step.details"),
        t("wallet.send.review"),
        t("offline.send.step.sign"),
        t("offline.send.step.broadcast"),
      ]
    : [t("wallet.send.step.details"), t("wallet.send.review"), t("wallet.sent.title")];
  const current = watch ? (scanning ? 3 : request ? 2 : quote ? 1 : 0) : sent ? 3 : quote ? 1 : 0;

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <Steps steps={steps} current={current} />
      </ToolbarAccessory>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...PAGE}>
          {sent && quote ? (
            <Sent tx={sent} quote={quote} />
          ) : scanning && request ? (
            <BroadcastFlow expect={request.tx.id} onBack={() => setScanning(false)} />
          ) : request ? (
            <div className="flex flex-col gap-5">
              <DocCard
                doc={request.doc}
                fingerprint={request.tx.fingerprint}
                fileName={docFileName("request", request.tx.nonce, request.tx.fingerprint)}
                title={t("offline.send.requestTitle")}
                desc={t("offline.send.requestDesc")}
              />
              <div className="flex justify-center">
                <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={() => setScanning(true)}>
                  <ScanLine className="size-4" />
                  {t("offline.send.scanSigned")}
                </button>
              </div>
              <p className="text-center text-sm text-muted-foreground">{t("offline.send.later")}</p>
            </div>
          ) : quote ? (
            <Review
              quote={quote}
              label={label}
              watchOnly={watch}
              onBack={() => setQuote(null)}
              onSent={setSent}
              onRequest={setRequest}
            />
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

/** The custom price's field, at its width in the fee switch; Custom's own width is its label's. */
const FEE_FIELD_WIDTH = 152;
/** The fee switch's well, round its segments (p-[3px]). */
const FEE_INSET = 3;

/**
 * FeeSwitch picks the network fee, as a segmented control does, Auto or
 * Custom: chosen, Custom opens out into the price's own field. One lit
 * thumb glides from Auto onto Custom and widens with it into the field's
 * well, on the same spring as the segment, Custom's name giving way to the
 * field as it goes; Auto draws it all back. Both stay laid out throughout,
 * so nothing jumps as one replaces the other.
 */
function FeeSwitch({
  id,
  mode,
  onMode,
  gwei,
  onGwei,
}: {
  id: string;
  mode: FeeMode;
  onMode: (m: FeeMode) => void;
  gwei: string;
  onGwei: (v: string) => void;
}) {
  const t = useT();
  const custom = mode === "custom";
  const auto = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Auto's width, as its label sets it in the interface's language: where the thumb starts, and where Custom does
  const [autoWidth, setAutoWidth] = useState<number | null>(null);
  const autoLabel = t("wallet.send.feeAuto");
  useLayoutEffect(() => {
    if (auto.current) setAutoWidth(auto.current.offsetWidth);
  }, [autoLabel]);

  // The field takes the focus as it opens on a click, not as the form returns from its review already custom
  const opened = useRef(false);
  useEffect(() => {
    if (custom && opened.current) field.current?.focus();
    opened.current = true;
  }, [custom]);

  return (
    <div
      role="radiogroup"
      aria-label={t("wallet.send.fee")}
      className="relative inline-flex w-fit rounded-[10px] bg-segment-well p-[3px]"
    >
      {/* The one thumb, under whichever segment is chosen */}
      {autoWidth !== null && (
        <motion.span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] left-0 rounded-[7px] bg-segment-thumb shadow-[var(--shadow-segment)]"
          initial={false}
          animate={{
            x: custom ? FEE_INSET + autoWidth : FEE_INSET,
            width: custom ? FEE_FIELD_WIDTH : autoWidth,
          }}
          transition={SPRING}
        />
      )}
      <button
        ref={auto}
        type="button"
        role="radio"
        aria-checked={!custom}
        onClick={() => onMode("suggested")}
        className={`relative h-7 min-w-20 rounded-[7px] px-4 font-medium whitespace-nowrap transition-colors duration-200 ${
          custom ? "text-muted-foreground hover:text-foreground" : "text-foreground"
        }`}
      >
        {autoLabel}
      </button>
      <motion.div
        className="relative h-7 overflow-hidden rounded-[7px]"
        // At rest as wide as Custom's name; open, the field's width
        initial={false}
        animate={{ width: custom ? FEE_FIELD_WIDTH : "auto" }}
        transition={SPRING}
      >
        {/* Custom's name: it sets the segment's width at rest, and fades as the field opens over it */}
        <motion.button
          type="button"
          role="radio"
          aria-checked={custom}
          tabIndex={custom ? -1 : 0}
          onClick={() => onMode("custom")}
          className={`relative h-full min-w-20 px-4 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground ${
            custom ? "pointer-events-none" : ""
          }`}
          initial={false}
          animate={{ opacity: custom ? 0 : 1, transition: custom ? FADE_OUT : FADE_IN }}
        >
          {t("wallet.send.feeManual")}
        </motion.button>
        {/* The price's field, laid out at its full width throughout, uncovered as the segment widens */}
        <motion.label
          className={`absolute inset-y-0 left-0 flex items-center ${custom ? "" : "pointer-events-none"}`}
          style={{ width: FEE_FIELD_WIDTH }}
          initial={false}
          animate={{
            opacity: custom ? 1 : 0,
            transition: custom ? { ...FADE_IN, delay: 0.06 } : FADE_OUT,
          }}
        >
          <input
            ref={field}
            id={id}
            className="h-full w-full min-w-0 bg-transparent pr-12 pl-3 font-medium tabular-nums outline-none placeholder:text-faint"
            inputMode="decimal"
            placeholder="1"
            value={gwei}
            onChange={(e) => onGwei(e.target.value.replace(",", "."))}
            aria-label={t("wallet.send.gasPrice")}
            autoComplete="off"
            disabled={!custom}
          />
          <span className="pointer-events-none absolute right-3 text-sm text-muted-foreground">gwei</span>
        </motion.label>
      </motion.div>
    </div>
  );
}

type NotReady = { kind: "stopped" | "noPeers" | "syncing"; hint: string };

/** The node's readiness to send: why not, or null when it can. */
function useNotReady(): NotReady | null {
  const t = useT();
  const node = useNode();
  if (!node?.running) return { kind: "stopped", hint: t("wallet.send.connectHint") };
  // The development chain has no peers: it seals what it is sent itself
  if (node.peers === 0 && !node.devChain) return { kind: "noPeers", hint: t("wallet.err.noPeers") };
  if (node.syncing) return { kind: "syncing", hint: t("wallet.err.syncing") };
  return null;
}

/**
 * SendButton is the form's one button: Review once the node can send.
 * Before, it says why not where the eye already is: Connect while the node
 * is off, a click away, or what the node is waiting on, with the reason
 * under it. What's typed stays meanwhile.
 */
function SendButton({ notReady, ready, busy }: { notReady: NotReady | null; ready: boolean; busy: boolean }) {
  const t = useT();
  const node = useNode();
  const { busy: connecting, err, toggle: connect } = useNodeSwitch();
  const progress = syncProgress(node);

  let button: ReactNode;
  if (notReady?.kind === "stopped") {
    button = (
      <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={connect} disabled={connecting}>
        {connecting && <Loader2 className="size-4 animate-spin" />}
        {connecting ? t("node.starting") : t("node.start")}
      </button>
    );
  } else if (notReady) {
    button = (
      <button type="button" className="btn btn-primary btn-lg min-w-64" disabled>
        <Loader2 className="size-4 animate-spin" />
        {notReady.kind === "syncing" ? t("wallet.send.syncing") : t("wallet.send.findingPeers")}
        {notReady.kind === "syncing" && progress > 0 && <span className="tabular-nums">{formatPercent(progress)}</span>}
      </button>
    );
  } else {
    button = (
      <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!ready || busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("wallet.send.review")}
        {!busy && <ArrowRight className="size-4" />}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2.5">
      {notReady?.kind === "stopped" && err && (
        <Notice tone="critical" className="w-full">
          {err}
        </Notice>
      )}
      {button}
      {notReady && (
        <p className="max-w-md text-center text-sm text-muted-foreground" role="status">
          {notReady.hint}
        </p>
      )}
    </div>
  );
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
            {(id) => <RecipientInput id={id} value={to} onChange={set.setTo} view={view} />}
          </Field>
        </div>
        <div className="p-4">
          <Field
            label={t("wallet.send.fee")}
            hint={feeMode === "suggested" ? t("wallet.send.feeSuggested") : t("wallet.send.feeCustom")}
          >
            {(id) => <FeeSwitch id={id} mode={feeMode} onMode={set.setFeeMode} gwei={gwei} onGwei={set.setGwei} />}
          </Field>
        </div>
      </Panel>

      {error && <Notice tone="critical">{error}</Notice>}
      <SendButton notReady={notReady} ready={ready} busy={busy !== null} />
    </form>
  );
}

function Review({
  quote,
  label,
  watchOnly,
  onBack,
  onSent,
  onRequest,
}: {
  quote: SendQuote;
  label: string;
  watchOnly: boolean;
  onBack: () => void;
  onSent: (tx: SentTx) => void;
  onRequest: (r: SigningRequest) => void;
}) {
  const t = useT();
  const { byAddress } = useContacts();
  const { info } = useWallet();
  // Named where the wallet knows it: one of its own accounts first, as Sent names it, else a contact
  const own = info?.accounts.find((a) => sameAddress(a.address, quote.to));
  const named =
    own && info
      ? { name: accountLabel(own, info.accounts, t), kind: t("wallet.review.ownAccount") }
      : (() => {
          const c = byAddress(quote.to);
          return c ? { name: c.name, kind: t("wallet.review.contact") } : null;
        })();
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A watch-only account signs elsewhere: the review makes its request
  const makeRequest = async () => {
    setBusy(true);
    setError(null);
    try {
      onRequest(
        await api.offlineBuildRequest({
          from: quote.from,
          to: quote.to,
          valueWei: quote.valueWei,
          gasPriceWei: quote.gasPriceWei,
          gasLimit: quote.gasLimit,
          memo,
        }),
      );
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

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
      });
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
          <div className="flex w-full max-w-2xl flex-col items-center gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowDown className="size-3.5" />
              {t("wallet.send.to")}
            </span>
            {named ? (
              // One of the wallet's accounts or a contact: its name is what to
              // recognise, what it is beside it, its whole address under it to check
              <span className="flex items-center gap-3.5 rounded-2xl bg-muted px-5 py-3.5">
                <AddressAvatar address={quote.to} size={40} />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="flex max-w-full items-center gap-2">
                    <span className="truncate text-2xl font-semibold tracking-tight">{named.name}</span>
                    <Pill tone="brand" className="shrink-0">
                      {named.kind}
                    </Pill>
                  </span>
                  <Address value={quote.to} className="text-left text-sm text-muted-foreground" />
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
          if (watchOnly) {
            if (quote.sufficient && !busy) makeRequest();
          } else if (quote.sufficient && !busy) send();
        }}
      >
        {watchOnly && (
          <Panel className="p-4">
            <Field label={t("offline.memo")} hint={t("offline.send.memoHint")}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={memo}
                  maxLength={200}
                  placeholder={t("offline.send.memoPlaceholder")}
                  onChange={(e) => setMemo(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
          </Panel>
        )}
        {error && <Notice tone="critical">{error}</Notice>}
        <div className="flex justify-center gap-3">
          <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </button>
          {watchOnly ? (
            <button type="submit" className="btn btn-primary btn-lg min-w-56" disabled={busy || !quote.sufficient}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              {t("offline.send.cta")}
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary btn-lg min-w-56"
              disabled={busy || !quote.sufficient}
              autoFocus
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
              {busy ? t("wallet.review.signing") : t("wallet.review.cta")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** How long the Send page's confirmation stays before returning to the overview (ms). */
const SENT_PAGE_MS = 10_000;

/**
 * Sent confirms a send as the assistant bar confirms one an assistant asked
 * for, laid out for the page: the check drawing itself in, what left, where
 * to, and the transaction itself. Beneath Done, a slim bar runs down the
 * time until it returns to the overview by itself.
 */
function Sent({ tx, quote }: { tx: SentTx; quote: SendQuote }) {
  const t = useT();
  const navigate = useNavigate();
  const { byAddress } = useContacts();
  const { info } = useWallet();
  useEffect(() => {
    const close = setTimeout(() => navigate("/"), SENT_PAGE_MS);
    return () => clearTimeout(close);
  }, [navigate]);
  const own = info?.accounts.find((a) => sameAddress(a.address, quote.to));
  const toName = own && info ? accountLabel(own, info.accounts, t) : byAddress(quote.to)?.name;
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 pt-10 text-center">
      <span className="scale-150">
        <DrawnCheck />
      </span>
      <motion.div
        className="flex flex-col items-center gap-2"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.15 } }}
      >
        <h2 className="text-3xl font-semibold tracking-tight">{t("wallet.sent.title")}</h2>
        <p className="text-lg">{t("wallet.sent.desc", { amount: formatUnits(quote.valueWei, LAX_DECIMALS) })}</p>
        <p className="max-w-md text-muted-foreground">{t("wallet.sent.wait")}</p>
      </motion.div>
      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: 0.25 } }}
      >
        <Rows as="dl" className="w-full text-left">
          <Property label={t("wallet.send.to")} mono>
            <GroupedAddress address={quote.to} className="truncate" />
            {toName && <span className="shrink-0 font-sans text-muted-foreground">{toName}</span>}
          </Property>
          <Property label={t("wallet.sent.hash")} mono>
            <span className="selectable truncate">{tx.hash}</span>
            <CopyButton value={tx.hash} className="-my-1 -mr-2" />
          </Property>
          <Property label={t("wallet.sent.nonce")}>{formatInt(tx.nonce)}</Property>
        </Rows>
      </motion.div>
      <motion.div
        className="flex flex-col items-center gap-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { ...SPRING, delay: 0.35 } }}
      >
        <button type="button" className="btn btn-primary btn-lg min-w-36" onClick={() => navigate("/")}>
          {t("wallet.sent.done")}
        </button>
        <span aria-hidden className="h-[3px] w-36 overflow-hidden rounded-full bg-muted">
          <motion.span
            className="block h-full origin-left bg-brand-fill"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: SENT_PAGE_MS / 1000, ease: "linear" }}
          />
        </span>
      </motion.div>
    </div>
  );
}

/** Whether a recipient typed so far is a name to look up, not an address being pasted. */
function looksLikeName(s: string): boolean {
  return !/^0x[0-9a-f]*$/i.test(s);
}

/** How many recent counterparties the list offers. */
const RECENT = 8;

type SuggestionTab = "recent" | "contacts";

/** A suggestion in the recipient's list: an address, named where the wallet knows it. */
type Suggestion = {
  address: string;
  name?: string;
  /** Whether it is in the contacts: a contact goes by its name alone, as the From field's account does. */
  contact?: boolean;
  /** For a recent one: which way it went, and when (0 while in the pool). */
  recent?: { kind: "in" | "out"; time: number };
};

/**
 * RecipientInput is the recipient's address, with what to pick it from
 * listed under it as the field is focused, on two tabs: the addresses
 * this account last sent to or received from, and the contacts
 * (recently sent to first, then favourites). Recent shows first while it
 * has anything to show, until a tab is chosen. Typing a name, part of an
 * address or a note narrows both. Arrow keys move through the list,
 * Enter picks, Escape closes.
 */
function RecipientInput({
  id,
  value,
  onChange,
  view,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** The sending account's activity, for its recent counterparties. */
  view: AddressView | null;
}) {
  const t = useT();
  const ago = useAgo();
  const { contacts, byAddress } = useContacts();
  const { info } = useWallet();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The field is focused as the page arrives: the list waits for the user's own focus
  const ready = useRef(false);
  useEffect(() => {
    ready.current = true;
  }, []);
  const listId = useId();
  const stagger = useStagger();

  const q = value.trim().toLowerCase();
  const { recent, book } = useMemo(() => {
    // A complete address needs no suggestions
    if (isAddress(q)) return { recent: [], book: [] };
    const nameOf = (address: string) => {
      const contact = byAddress(address);
      if (contact) return contact.name;
      const own = info?.accounts.find((a) => sameAddress(a.address, address));
      return own && info ? accountLabel(own, info.accounts, t) : undefined;
    };
    const matches = (s: Suggestion, note = "") =>
      !q ||
      s.address.toLowerCase().includes(q) ||
      !!s.name?.toLowerCase().includes(q) ||
      note.toLowerCase().includes(q);

    // The account's last counterparties in transfers, newest first, each once
    const recent: Suggestion[] = [];
    if (view) {
      const seen = new Set<string>();
      for (const tx of [...view.pending, ...view.transactions]) {
        if (tx.kind !== "transfer" || ("failed" in tx && tx.failed)) continue;
        const out = sameAddress(tx.from, view.address);
        const other = out ? tx.to : tx.from;
        if (!other || sameAddress(other, view.address) || seen.has(other.toLowerCase())) continue;
        seen.add(other.toLowerCase());
        const s = {
          address: other,
          name: nameOf(other),
          contact: !!byAddress(other),
          recent: { kind: out ? "out" : "in", time: tx.timestamp },
        } as const;
        if (matches(s)) recent.push(s);
        if (recent.length === RECENT) break;
      }
    }
    const book = [...(contacts ?? [])]
      .sort(
        (a, b) =>
          b.lastSentAt - a.lastSentAt || Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name),
      )
      .filter((c) => matches(c, c.note))
      .map((c): Suggestion => ({ address: c.address, name: c.name, contact: true }));
    return { recent, book };
  }, [contacts, byAddress, info, view, q, t]);
  const [chosen, setChosen] = useState<SuggestionTab | null>(null);
  const tab: SuggestionTab = chosen ?? (recent.length > 0 ? "recent" : "contacts");
  const all = tab === "recent" ? recent : book;
  // Open while either tab has something to offer; a tab with nothing says so
  const showing = open && recent.length + book.length > 0;

  const pos = usePopup(showing, setOpen, field, menu);

  useEffect(() => setActive(0), [q, tab]);
  // The row the keys reach scrolls into view
  useEffect(() => {
    if (showing) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [showing, active, listId]);

  const pick = (address: string) => {
    onChange(address);
    setOpen(false);
    setEditing(false);
  };

  // A contact's address shows as the contact, by name, as the From field
  // shows its account; clicked, it opens to its address to change
  const [editing, setEditing] = useState(false);
  const toContact = isAddress(value.trim()) ? byAddress(value.trim()) : undefined;
  useEffect(() => {
    if (!editing) return;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  // Each row as the From list draws an account: its avatar, its name over
  // its short address, and on the right, for a recent one, when
  const row = (s: Suggestion, i: number) => (
    <motion.li key={s.address} role="presentation" variants={POPUP_ROW}>
      <button
        id={`${listId}-${i}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={i === active}
        data-active={i === active || undefined}
        onMouseEnter={() => setActive(i)}
        // The field keeps its focus, so picking leaves the caret there
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(s.address)}
        className="menu-item relative w-full gap-2.5 py-2"
      >
        <AddressAvatar address={s.address} size={28} />
        {/* A contact by its name alone; any other address in full where the row
            has room for it, shortened where it hasn't */}
        <span className="@container flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">
              {s.name ?? (s.recent ? t(`wallet.kind.${s.recent.kind}`) : shortHex(s.address, 8, 6))}
            </span>
            {s.contact && <ContactMark />}
          </span>
          {!s.contact && (
            <>
              <span className="hidden truncate text-xs text-muted-foreground @sm:block">
                <GroupedAddress address={s.address} />
              </span>
              <span className="flex @sm:hidden">
                <ShortAddress address={s.address} />
              </span>
            </>
          )}
        </span>
        {s.recent && (
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {s.recent.time ? ago(s.recent.time) : t("wallet.pending")}
          </span>
        )}
      </button>
    </motion.li>
  );

  if (toContact && !editing) {
    return (
      // As tall as the From field above it (h-11), the contact drawn as its account is
      <div className="input flex h-11 items-center gap-1 pr-1.5">
        <button
          id={id}
          type="button"
          onClick={() => setEditing(true)}
          className="flex h-full min-w-0 flex-1 items-center gap-3 text-left"
        >
          <AddressAvatar address={toContact.address} size={28} />
          <span className="truncate font-medium">{toContact.name}</span>
          <ContactMark />
        </button>
        <Tooltip content={t("common.clear")}>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon size-6"
            onClick={() => {
              onChange("");
              setEditing(true);
            }}
            aria-label={t("common.clear")}
          >
            <X className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <>
      <input
        ref={field}
        id={id}
        className="input h-11 font-mono"
        placeholder={(contacts?.length ?? 0) > 0 ? t("wallet.send.toPlaceholder") : "0x…"}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => ready.current && setOpen(true)}
        onClick={() => setOpen(true)}
        // Tabbing on closes it, and a contact's address shows as the contact again
        onBlur={(e) => {
          if (menu.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Only the list closes, not what it sits in
            if (showing) {
              e.preventDefault();
              e.stopPropagation();
            }
            setOpen(false);
            return;
          }
          if (!showing) {
            if (e.key === "ArrowDown" && recent.length + book.length > 0) {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          // A tab with nothing on it has nothing to move through or pick
          if (all.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % all.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + all.length) % all.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(all[Math.min(active, all.length - 1)].address);
          }
        }}
        role="combobox"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && all.length > 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        spellCheck={false}
        autoComplete="off"
        autoFocus
      />
      {/* Over the window, as the account picker's list is, so the panel can't cut it */}
      {createPortal(
        <AnimatePresence>
          {showing && (
            <motion.div
              ref={menu}
              className={`menu no-drag fixed z-[150] flex flex-col p-1.5 ${pos?.up ? "origin-bottom" : "origin-top"}`}
              // Placed by left and top (or, above the field, bottom): motion owns the transform
              style={{
                left: pos?.x ?? 0,
                ...(pos?.up ? { bottom: pos.bottom } : { top: pos?.y ?? 0 }),
                // As wide as the field, measured so too before it is placed
                width: pos?.width ?? field.current?.offsetWidth,
                visibility: pos ? "visible" : "hidden",
              }}
              {...POPUP}
              // The field keeps its focus as a tab is chosen, or the list scrolled
              onMouseDown={(e) => e.preventDefault()}
            >
              <Segmented<SuggestionTab>
                size="sm"
                className="mb-1.5 self-start"
                value={tab}
                onChange={setChosen}
                options={[
                  { value: "recent", label: t("wallet.send.recent") },
                  { value: "contacts", label: t("nav.contacts") },
                ]}
              />
              <AnimatePresence mode="wait" initial={false}>
                {all.length > 0 ? (
                  <motion.ul
                    key={tab}
                    id={listId}
                    role="listbox"
                    aria-label={tab === "recent" ? t("wallet.send.recent") : t("nav.contacts")}
                    className="flex max-h-72 flex-col gap-px overflow-y-auto"
                    {...stagger}
                    variants={POPUP_ROWS}
                    exit={{ opacity: 0, transition: FADE_OUT }}
                  >
                    {all.map((s, i) => row(s, i))}
                  </motion.ul>
                ) : (
                  <motion.p
                    key={`${tab}:empty`}
                    className="px-2 py-4 text-center text-sm text-muted-foreground"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: FADE_IN }}
                    exit={{ opacity: 0, transition: FADE_OUT }}
                  >
                    {tab === "recent"
                      ? t(q ? "wallet.send.noRecentMatch" : "wallet.send.noRecent")
                      : t(q ? "wallet.send.noContactMatch" : "wallet.send.noContacts")}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** ContactMark marks a name as a contact's, with the contacts' icon. */
function ContactMark() {
  const t = useT();
  return (
    <Tooltip content={t("contacts.inBook")}>
      <BookUser className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("contacts.inBook")} />
    </Tooltip>
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
