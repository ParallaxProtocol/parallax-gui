import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Loader2, Radio } from "lucide-react";
import { api, SentTx, SignedReview, walletError } from "../../lib/api";
import { docKind } from "../../lib/offline";
import { PAGE } from "../../lib/motion";
import { PAGE_WIDE } from "../../lib/layout";
import { ToolbarAccessory } from "../../lib/toolbar";
import { Steps } from "../Wallet/flow";
import { useT } from "../../i18n";
import { Property, Rows } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { ScanCard } from "../../components/offline/QRScanner";
import { Fingerprint, TxSummary } from "../../components/offline/parts";
import { DrawnCheck } from "../Wallet/common";
import { formatInt } from "../../lib/format";

/** BroadcastPage takes a transaction signed offline, from any request or from parallax-wallet, to the network. */
export default function BroadcastPage() {
  const t = useT();
  const [step, setStep] = useState(0);
  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <Steps
          steps={[t("offline.sign.step.scan"), t("offline.sign.step.review"), t("offline.nav.broadcast")]}
          current={step}
        />
      </ToolbarAccessory>
      <BroadcastFlow onStep={setStep} />
    </div>
  );
}

/**
 * BroadcastFlow scans a signed transaction, shows it as checked against
 * the request it answers (`expect`, when the flow follows one), and sends
 * it. Each step is checked again by the backend.
 */
export function BroadcastFlow({
  expect,
  onBack,
  onStep,
}: {
  expect?: string;
  onBack?: () => void;
  /** Told the step shown (0 scan, 1 review, 3 done), for a page's step indicator. */
  onStep?: (step: number) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<string | null>(null);
  const [review, setReview] = useState<SignedReview | null>(null);
  const [sent, setSent] = useState<SentTx | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanned = async (text: string) => {
    setError(null);
    try {
      const r = await api.offlineReviewSigned(text);
      if (expect && r.tx.id.toLowerCase() !== expect.toLowerCase()) {
        setError(t("offline.broadcast.otherRequest", { fingerprint: r.tx.fingerprint }));
        return;
      }
      setReview(r);
      setDoc(text);
    } catch (e) {
      setError(walletError(e, t));
    }
  };

  const broadcast = async () => {
    if (!doc || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await api.offlineBroadcast(doc));
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const step = sent ? "sent" : review ? "review" : "scan";
  useEffect(() => onStep?.(sent ? 3 : review ? 1 : 0), [sent, review, onStep]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step + (error ? ":e" : "")} {...PAGE} className="flex flex-col gap-5">
        {sent && review ? (
          <div className="flex flex-col items-center gap-6 pt-6 text-center">
            <span className="scale-150">
              <DrawnCheck />
            </span>
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-3xl font-semibold tracking-tight">{t("offline.broadcast.done")}</h2>
              <p className="max-w-md text-muted-foreground">{t("wallet.sent.wait")}</p>
            </div>
            <Rows as="dl" className="w-full text-left">
              <Property label={t("wallet.sent.hash")} mono>
                <span className="selectable truncate">{sent.hash}</span>
                <CopyButton value={sent.hash} className="-my-1 -mr-2" />
              </Property>
              <Property label={t("wallet.sent.nonce")}>{formatInt(sent.nonce)}</Property>
            </Rows>
            <button type="button" className="btn btn-primary btn-lg min-w-36" onClick={() => navigate("/")}>
              {t("wallet.sent.done")}
            </button>
          </div>
        ) : review ? (
          <>
            <TxSummary tx={review.tx} />
            {review.matched ? (
              <Notice tone="info">
                {t("offline.broadcast.matched")} <Fingerprint value={review.tx.fingerprint} />
              </Notice>
            ) : (
              <Notice tone="warn">{t("offline.broadcast.unmatched")}</Notice>
            )}
            {review.warnings.map((w) => (
              <Notice key={w} tone="warn">
                {t(`offline.broadcast.warn.${w}`)}
              </Notice>
            ))}
            {error && <Notice tone="critical">{error}</Notice>}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                className="btn btn-secondary btn-lg min-w-36"
                onClick={() => {
                  setReview(null);
                  setDoc(null);
                }}
                disabled={busy}
              >
                <ArrowLeft className="size-4" />
                {t("common.back")}
              </button>
              <button type="button" className="btn btn-primary btn-lg min-w-56" onClick={broadcast} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
                {t("offline.broadcast.cta")}
              </button>
            </div>
          </>
        ) : (
          <ScanCard
            title={t("offline.broadcast.scanTitle")}
            desc={t("offline.broadcast.scanDesc")}
            error={error}
            accept={(text) => {
              const k = docKind(text);
              return k === "signed" || k === "raw" ? null : t("offline.scan.notSigned");
            }}
            onScan={scanned}
            onBack={onBack}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
