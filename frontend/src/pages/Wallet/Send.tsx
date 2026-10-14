import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CheckCircle2, Loader2, Send as SendIcon } from "lucide-react";
import { api, SendQuote, SentTx, walletError } from "../../lib/api";
import { formatGwei, formatInt, formatLax, formatUnits, isAddress, parseUnits } from "../../lib/format";
import { useNode } from "../../lib/live";
import { PAGE } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Property, Rows, Section } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Segmented } from "../../components/ui/Segmented";
import { Address, Field, PasswordInput, useSummary } from "./common";

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
  // The form keeps what was typed while the review shows
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("suggested");
  const [gwei, setGwei] = useState("");

  // Another account selected: start over, nothing carried across
  useEffect(() => {
    setQuote(null);
    setSent(null);
  }, [account?.address]);

  if (!info) return null;
  if (!account) {
    return (
      <div className="p-5">
        <Notice tone="info" action={<Link to="/" className="btn btn-secondary">{t("wallet.welcome.cta")}</Link>}>
          {t("wallet.noAccount")}
        </Notice>
      </div>
    );
  }
  const label = accountLabel(account, info.accounts, t);
  const step = sent ? "sent" : quote ? "review" : "form";

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-5">
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
              label={label}
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
  if (node.peers === 0) return t("wallet.err.noPeers");
  if (node.syncing) return t("wallet.err.syncing");
  return null;
}

function SendForm({
  from,
  label,
  state,
  set,
  onQuote,
}: {
  from: string;
  label: string;
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
    <Section title={t("wallet.send.title")}>
      {notReady && <Notice tone="info">{notReady}</Notice>}
      <Panel className="p-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <Field label={t("wallet.send.from")}>
            {() => (
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                <span className="min-w-0 truncate">
                  {label} <span className="font-mono text-sm text-muted-foreground">{from}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {view?.balanceWei ? `${formatLax(view.balanceWei, 6)} LAX` : "—"}
                </span>
              </div>
            )}
          </Field>

          <Field
            label={t("wallet.send.to")}
            error={toTrim && !toOk ? t("wallet.err.badRecipient") : null}
            hint={t("wallet.send.toHint")}
          >
            {(id) => (
              <input
                id={id}
                className="input font-mono"
                placeholder="0x…"
                value={to}
                onChange={(e) => set.setTo(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
            )}
          </Field>

          <Field
            label={t("wallet.send.amount")}
            error={amount && valueWei === null ? t("wallet.err.badAmount") : null}
            aside={
              <button type="button" className="btn btn-ghost btn-sm" onClick={max} disabled={!toOk || !!notReady || busy !== null}>
                {busy === "max" && <Loader2 className="size-3 animate-spin" />}
                {t("wallet.send.max")}
              </button>
            }
          >
            {(id) => (
              <div className="relative">
                <input
                  id={id}
                  className="input pr-12 tabular-nums"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => set.setAmount(e.target.value.replace(",", "."))}
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">LAX</span>
              </div>
            )}
          </Field>

          <Field label={t("wallet.send.fee")} hint={feeMode === "suggested" ? t("wallet.send.feeSuggested") : t("wallet.send.feeCustom")}>
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
                      className="input pr-12 tabular-nums"
                      inputMode="decimal"
                      placeholder="1"
                      value={gwei}
                      onChange={(e) => set.setGwei(e.target.value.replace(",", "."))}
                      aria-label={t("wallet.send.gasPrice")}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">gwei</span>
                  </div>
                )}
              </div>
            )}
          </Field>

          {error && <Notice tone="critical">{error}</Notice>}
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={!ready || busy !== null}>
              {busy === "quote" && <Loader2 className="size-3.5 animate-spin" />}
              {t("wallet.send.review")}
            </button>
          </div>
        </form>
      </Panel>
    </Section>
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
    <Section title={t("wallet.review.title")}>
      <Rows as="dl">
        <Property label={t("wallet.send.from")}>
          <span className="truncate">{label}</span>
        </Property>
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <dt className="text-muted-foreground">{t("wallet.send.to")}</dt>
          <dd className="text-[15px] leading-relaxed">
            <Address value={quote.to} />
          </dd>
          <dd className="text-sm text-muted-foreground">{t("wallet.review.checkAddress")}</dd>
        </div>
        <Property label={t("wallet.send.amount")}>
          <span className="text-lg font-semibold">{formatUnits(quote.valueWei, LAX_DECIMALS)} LAX</span>
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
          <span className="font-semibold">{formatUnits(quote.totalWei, LAX_DECIMALS)} LAX</span>
        </Property>
        <Property label={t("wallet.review.network")}>
          <span>Parallax · {t("wallet.review.chainId", { id: quote.chainId })}</span>
        </Property>
      </Rows>

      {!quote.sufficient && <Notice tone="critical">{t("wallet.err.insufficient")}</Notice>}
      {quote.toSelf && <Notice tone="info">{t("wallet.review.toSelf")}</Notice>}
      {quote.toContract && <Notice tone="warn">{t("wallet.review.toContract")}</Notice>}
      {dear && <Notice tone="warn">{t("wallet.review.dear", { price: formatGwei(quote.suggestedPriceWei) })}</Notice>}

      <Panel className="p-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && quote.sufficient) send();
          }}
        >
          <Field label={t("wallet.password")} hint={t("wallet.review.passwordHint")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
          </Field>
          {error && <Notice tone="critical">{error}</Notice>}
          <div className="flex justify-between gap-2">
            <button type="button" className="btn btn-secondary" onClick={onBack} disabled={busy}>
              <ArrowLeft className="size-3.5" />
              {t("common.back")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !password || !quote.sufficient}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
              {busy ? t("wallet.review.signing") : t("wallet.review.cta")}
            </button>
          </div>
        </form>
      </Panel>
    </Section>
  );
}

function Sent({ tx, quote, onAgain }: { tx: SentTx; quote: SendQuote; onAgain: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Section title={t("wallet.sent.title")}>
      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good-ink" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">
              {t("wallet.sent.desc", { amount: formatUnits(quote.valueWei, LAX_DECIMALS) })}
            </span>
            <span className="text-sm text-muted-foreground">{t("wallet.sent.wait")}</span>
          </div>
        </div>
        <Rows as="dl">
          <Property label={t("wallet.sent.hash")} mono>
            <span className="selectable truncate">{tx.hash}</span>
            <CopyButton value={tx.hash} className="-my-1 -mr-2" />
          </Property>
          <Property label={t("wallet.send.to")} mono>
            <span className="selectable truncate">{quote.to}</span>
          </Property>
          <Property label={t("wallet.sent.nonce")}>{formatInt(tx.nonce)}</Property>
        </Rows>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onAgain}>
            {t("wallet.sent.again")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            {t("wallet.sent.done")}
          </button>
        </div>
      </Panel>
    </Section>
  );
}
