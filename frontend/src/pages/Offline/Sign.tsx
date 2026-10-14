import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Loader2, PenLine, ScanLine } from "lucide-react";
import { api, MessageRequest, RequestReview, SignedMessage, SignedOffline, walletError } from "../../lib/api";
import { docFileName, docKind, messageFileName } from "../../lib/offline";
import { accountLabel, useWallet } from "../../lib/wallet";
import { shortHex } from "../../lib/format";
import { Fingerprint } from "../../components/offline/parts";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { PAGE } from "../../lib/motion";
import { PAGE_WIDE } from "../../lib/layout";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useT } from "../../i18n";
import { Panel, Property, Rows } from "../../components/ui/Panel";
import { GlowCard } from "../../components/ui/GlowCard";
import { Notice } from "../../components/ui/bits";
import { ScanCard } from "../../components/offline/QRScanner";
import { DocCard, TxSummary } from "../../components/offline/parts";
import { messageBytes } from "../Messages";
import { Field, PasswordInput } from "../Wallet/common";
import { Steps } from "../Wallet/flow";

/**
 * SignPage is the offline signer's one job: scan a signing request from
 * the watch-only wallet's screen (a transfer, or a message), show
 * everything it would sign, sign it with the wallet password, and show the
 * result to scan back. The backend checks the request again before it
 * signs.
 */
export default function SignPage() {
  const t = useT();
  const [doc, setDoc] = useState<string | null>(null);
  const [review, setReview] = useState<RequestReview | null>(null);
  const [signed, setSigned] = useState<SignedOffline | null>(null);
  const [message, setMessage] = useState<MessageRequest | null>(null);
  const [signedMessage, setSignedMessage] = useState<SignedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restart = () => {
    setDoc(null);
    setReview(null);
    setSigned(null);
    setMessage(null);
    setSignedMessage(null);
    setError(null);
  };

  const scanned = async (text: string) => {
    setError(null);
    try {
      if (docKind(text) === "messageRequest") setMessage(await api.messageReviewRequest(text));
      else setReview(await api.offlineReviewRequest(text));
      setDoc(text);
    } catch (e) {
      setError(walletError(e, t));
    }
  };

  const done = signed || signedMessage;
  const step = done ? "signed" : review || message ? "review" : "scan";
  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <Steps
          steps={[t("offline.sign.step.scan"), t("offline.sign.step.review"), t("offline.sign.step.return")]}
          current={done ? 2 : review || message ? 1 : 0}
        />
      </ToolbarAccessory>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step + (error ? ":e" : "")} {...PAGE} className="flex flex-col gap-5">
          {signedMessage?.doc ? (
            <>
              <DocCard
                doc={signedMessage.doc}
                fingerprint={signedMessage.fingerprint}
                fileName={messageFileName("signed", signedMessage.fingerprint)}
                title={t("message.signed")}
                desc={t("message.offline.doneDesc")}
              />
              <div className="flex justify-center">
                <button type="button" className="btn btn-primary btn-lg min-w-56" onClick={restart}>
                  <ScanLine className="size-4" />
                  {t("offline.sign.another")}
                </button>
              </div>
            </>
          ) : message && doc ? (
            <MessageReview request={message} doc={doc} onBack={restart} onSigned={setSignedMessage} />
          ) : signed ? (
            <>
              <DocCard
                doc={signed.doc}
                fingerprint={signed.tx.fingerprint}
                fileName={docFileName("signed", signed.tx.nonce, signed.tx.fingerprint)}
                title={t("offline.sign.done")}
                desc={t("offline.sign.doneDesc")}
              />
              <div className="flex justify-center">
                <button type="button" className="btn btn-primary btn-lg min-w-56" onClick={restart}>
                  <ScanLine className="size-4" />
                  {t("offline.sign.another")}
                </button>
              </div>
            </>
          ) : review && doc ? (
            <SignReview review={review} doc={doc} onBack={restart} onSigned={setSigned} />
          ) : (
            <ScanCard
              title={t("offline.sign.scanTitle")}
              desc={t("offline.sign.scanDesc")}
              error={error}
              accept={(text) => {
                const k = docKind(text);
                return k === "request" || k === "messageRequest" ? null : t("offline.scan.notRequest");
              }}
              onScan={scanned}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SignReview({
  review,
  doc,
  onBack,
  onSigned,
}: {
  review: RequestReview;
  doc: string;
  onBack: () => void;
  onSigned: (s: SignedOffline) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPassword(""), []);

  const sign = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.offlineSignRequest(doc, password);
      setPassword("");
      onSigned(s);
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <TxSummary tx={review.tx} />
      {review.conflict && <Notice tone="warn" title={t("offline.sign.conflictTitle")}>{t("offline.sign.conflict")}</Notice>}
      {review.signed && <Notice tone="info">{t("offline.sign.already")}</Notice>}
      <Notice tone="info">{t("offline.sign.compare")}</Notice>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          sign();
        }}
      >
        <Panel className="p-4">
          <Field label={t("wallet.walletPassword")} hint={t("offline.sign.passwordHint")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
          </Field>
        </Panel>
        {error && <Notice tone="critical">{error}</Notice>}
        <div className="flex justify-center gap-3">
          <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </button>
          <button type="submit" className="btn btn-primary btn-lg min-w-56" disabled={busy || !password}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {busy ? t("wallet.review.signing") : t("offline.sign.cta")}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * MessageReview shows a message signing request in full, every character
 * that would be signed, before asking for the password.
 */
function MessageReview({
  request,
  doc,
  onBack,
  onSigned,
}: {
  request: MessageRequest;
  doc: string;
  onBack: () => void;
  onSigned: (s: SignedMessage) => void;
}) {
  const t = useT();
  const { info } = useWallet();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPassword(""), []);
  const acc = info?.accounts.find((a) => a.address === request.from);

  const sign = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.messageSignRequest(doc, password);
      setPassword("");
      onSigned(s);
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The message, every character of it, as the page's subject */}
      <GlowCard>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">{t("message.text")}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("message.bytes", { n: messageBytes(request.message), max: 1024 })}
            </span>
          </div>
          <p className="selectable max-h-80 overflow-y-auto text-xl leading-relaxed whitespace-pre-wrap break-words">
            {request.message}
          </p>
        </div>
      </GlowCard>
      <Rows as="dl">
        <Property label={t("message.signingAs")}>
          <AddressAvatar address={request.from} size={20} />
          <span className="truncate">{acc && info ? accountLabel(acc, info.accounts, t) : shortHex(request.from, 8, 6)}</span>
        </Property>
        <Property label={t("offline.fingerprint")}>
          <Fingerprint value={request.fingerprint} />
        </Property>
      </Rows>
      <Notice tone="info">{t("message.offline.compare")}</Notice>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          sign();
        }}
      >
        <Panel className="p-4">
          <Field label={t("wallet.walletPassword")} hint={t("message.passwordHint")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
          </Field>
        </Panel>
        {error && <Notice tone="critical">{error}</Notice>}
        <div className="flex justify-center gap-3">
          <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </button>
          <button type="submit" className="btn btn-primary btn-lg min-w-56" disabled={busy || !password}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {busy ? t("wallet.review.signing") : t("message.signCta")}
          </button>
        </div>
      </form>
    </div>
  );
}
