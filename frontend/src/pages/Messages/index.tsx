import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, FileCheck, Loader2, PenLine, QrCode, ScanLine, X } from "lucide-react";
import { api, MessageCheck, MessageRequest, SignedMessage, walletError } from "../../lib/api";
import { isAddress, sameAddress, shortHex } from "../../lib/format";
import { docKind, messageFileName, useOfflineMode } from "../../lib/offline";
import { useContacts } from "../../lib/contacts";
import { useWallet, accountLabel } from "../../lib/wallet";
import { PAGE } from "../../lib/motion";
import { PAGE_WIDE } from "../../lib/layout";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useT } from "../../i18n";
import { GlowCard } from "../../components/ui/GlowCard";
import { Panel, Property, Rows } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { ScanCard } from "../../components/offline/QRScanner";
import { DocCard } from "../../components/offline/parts";
import { Address, DrawnCheck, Field } from "../Wallet/common";
import { AccountSelect } from "../Wallet/AccountSelect";
import { Steps } from "../Wallet/flow";

/** Messages are at most this many bytes, as the backend takes them (message.go). */
export const MAX_MESSAGE_BYTES = 1024;

/** The byte length of a message as it is signed: its UTF-8. */
export const messageBytes = (s: string) => new TextEncoder().encode(s).length;

/** Whether a message has a character the backend refuses: a control other than line feed and tab. */
const hasControl = (s: string) => /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(s);

const messageOk = (s: string) => s.length > 0 && messageBytes(s) <= MAX_MESSAGE_BYTES && !hasControl(s);

/**
 * The message pages, laid out as Send is: the message as the page's
 * subject in a glowing card, the rest in grouped panels under it, the
 * step in the toolbar, and a finish like a sent transaction's.
 */

/**
 * SignMessagePage signs a message with the selected account, to prove it
 * controls its address. A watch-only account's message is signed on its
 * offline signer, by QR code.
 */
export function SignMessagePage() {
  const t = useT();
  const offline = useOfflineMode();
  const { info, account } = useWallet();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignedMessage | null>(null);
  const [request, setRequest] = useState<MessageRequest | null>(null);
  const [scanning, setScanning] = useState(false);
  // Another account: start over
  useEffect(() => {
    setResult(null);
    setRequest(null);
    setScanning(false);
    setError(null);
  }, [account?.address]);

  if (!info) return null;
  if (!account) {
    return (
      <div className={`p-5 ${PAGE_WIDE}`}>
        <Notice tone="info">{t("wallet.noAccount")}</Notice>
      </div>
    );
  }
  const watch = account.watchOnly;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const again = () => {
    setResult(null);
    setRequest(null);
    setScanning(false);
    setMessage("");
    setError(null);
  };

  const steps = watch
    ? [t("message.step.write"), t("offline.send.step.sign"), t("message.step.signed")]
    : [t("message.step.write"), t("message.step.signed")];
  const current = result ? steps.length : watch && request ? 1 : 0;
  const step = result ? "signed" : scanning ? "scan" : request ? "request" : "write";
  const ready = messageOk(message) && (!watch || !offline) && !busy;

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <Steps steps={steps} current={current} />
      </ToolbarAccessory>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...PAGE} className="flex flex-col gap-5">
          {result ? (
            <Signed signed={result} onAgain={again} />
          ) : scanning && request ? (
            <ScanPanel
              title={t("message.scanSigned")}
              desc={t("message.scanSignedDesc")}
              error={error}
              onBack={() => setScanning(false)}
              onScan={(text) =>
                run(async () => {
                  const r = await api.messageReviewSigned(text);
                  if (r.id.toLowerCase() !== request.id.toLowerCase() || !sameAddress(r.address, request.from)) {
                    throw new Error(t("message.err.otherRequest", { fingerprint: r.fingerprint }));
                  }
                  if (!r.valid) throw new Error(t("message.err.invalid"));
                  setResult(r);
                })
              }
            />
          ) : request ? (
            <>
              <DocCard
                doc={request.doc}
                fingerprint={request.fingerprint}
                fileName={messageFileName("request", request.fingerprint)}
                title={t("message.requestTitle")}
                desc={t("message.requestDesc")}
              />
              <div className="flex justify-center gap-3">
                <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={() => setRequest(null)}>
                  <ArrowLeft className="size-4" />
                  {t("common.back")}
                </button>
                <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={() => setScanning(true)}>
                  <ScanLine className="size-4" />
                  {t("message.scanSigned")}
                </button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ready) return;
                if (watch) run(async () => setRequest(await api.messageBuildRequest(account.address, message)));
                else
                  run(async () => {
                    setResult(await api.messageSign(account.address, message));
                  });
              }}
            >
              {/* The message, as the page's subject */}
              <GlowCard>
                <MessageInput value={message} onChange={setMessage} autoFocus />
              </GlowCard>

              {/* Who signs it */}
              <Panel className="p-4">
                <Field label={t("message.signingAs")} hint={watch ? t("message.watchHint") : undefined}>
                  {(id) => <AccountSelect id={id} noBalance />}
                </Field>
              </Panel>

              <Notice tone="info">{t("message.caution")}</Notice>
              {error && <Notice tone="critical">{error}</Notice>}
              <div className="flex justify-center">
                <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!ready}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : watch ? (
                    <QrCode className="size-4" />
                  ) : (
                    <PenLine className="size-4" />
                  )}
                  {watch ? t("message.createRequest") : t("message.signCta")}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * MessageInput is the message as the card's subject: a label over it, the
 * text, and its size as it is signed, or why it can't be.
 */
function MessageInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const bytes = messageBytes(value);
  const error =
    bytes > MAX_MESSAGE_BYTES ? t("message.err.tooLong") : hasControl(value) ? t("message.err.control") : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{t("message.text")}</span>
        <span
          className={`text-xs tabular-nums ${bytes > MAX_MESSAGE_BYTES ? "text-critical-ink" : "text-muted-foreground"}`}
        >
          {t("message.bytes", { n: bytes, max: MAX_MESSAGE_BYTES })}
        </span>
      </div>
      <textarea
        aria-label={t("message.text")}
        className="min-h-36 w-full resize-y bg-transparent text-xl leading-relaxed outline-none placeholder:text-faint"
        rows={5}
        value={value}
        placeholder={t("message.placeholder")}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoFocus={autoFocus}
      />
      {error && (
        <span className="text-sm text-critical-ink" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** The text block a signed message is shared as: what anyone needs to verify it. */
function shareText(s: SignedMessage, t: (k: string) => string): string {
  return `${t("message.share.address")}: ${s.address}\n${t("message.share.message")}:\n${s.message}\n${t("message.share.signature")}: ${s.signature}`;
}

/** Signed is the finish, as a sent transaction's: the check, then what to share. */
function Signed({ signed, onAgain }: { signed: SignedMessage; onAgain: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-6 pt-6 text-center">
      <span className="scale-150">
        <DrawnCheck />
      </span>
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-3xl font-semibold tracking-tight">{t("message.signed")}</h2>
        <p className="max-w-md text-muted-foreground">{t("message.signedDesc")}</p>
      </div>
      <Rows as="dl" className="w-full text-left">
        <Property label={t("message.share.address")} mono>
          <span className="selectable truncate">{signed.address}</span>
          <CopyButton value={signed.address} className="-my-1 -mr-2" />
        </Property>
        <div className="flex flex-col gap-1.5 px-5 py-3">
          <dt>{t("message.share.message")}</dt>
          <dd className="selectable rounded-xl bg-muted/60 p-3 break-words whitespace-pre-wrap text-muted-foreground">
            {signed.message}
          </dd>
        </div>
        <Property label={t("message.share.signature")} mono>
          <span className="selectable truncate">{signed.signature}</span>
          <CopyButton value={signed.signature} className="-my-1 -mr-2" />
        </Property>
      </Rows>
      <div className="flex justify-center gap-3">
        <CopyButton value={shareText(signed, t)} label className="btn-lg min-w-36" />
        <button type="button" className="btn btn-primary btn-lg min-w-36" onClick={onAgain}>
          {t("message.another")}
        </button>
      </div>
    </div>
  );
}

/** ScanPanel is a message's scanning step: the shared scanning card, taking signed messages. */
function ScanPanel({
  title,
  desc,
  error,
  onBack,
  onScan,
}: {
  title: string;
  desc: string;
  error: string | null;
  onBack: () => void;
  onScan: (text: string) => void;
}) {
  const t = useT();
  return (
    <ScanCard
      title={title}
      desc={desc}
      error={error}
      accept={(text) => (docKind(text) === "signedMessage" ? null : t("message.scan.notSigned"))}
      onScan={onScan}
      onBack={onBack}
    />
  );
}

/** VerifyMessagePage checks anyone's signed message: it needs no account. */
export function VerifyMessagePage() {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<(MessageCheck & { address: string; message: string }) | null>(null);

  const name = (a: string) => {
    const accounts = info?.accounts ?? [];
    const own = accounts.find((x) => sameAddress(x.address, a));
    if (own) return accountLabel(own, accounts, t);
    return byAddress(a)?.name ?? null;
  };
  const addr = address.trim();
  const ready = isAddress(addr) && messageOk(message) && signature.trim().length > 0 && !busy;

  const verify = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.messageVerify(addr, message, signature.trim());
      setCheck({ ...c, address: addr, message });
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const step = check ? "result" : scanning ? "scan" : "form";
  const known = isAddress(addr) ? name(addr) : null;
  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...PAGE} className="flex flex-col gap-5">
          {check ? (
            <VerifyResult
              check={check}
              signerName={name(check.valid ? check.address : check.recovered)}
              onBack={() => setCheck(null)}
              onAgain={() => {
                setCheck(null);
                setAddress("");
                setMessage("");
                setSignature("");
              }}
            />
          ) : scanning ? (
            <ScanPanel
              title={t("message.verify.scanTitle")}
              desc={t("message.verify.scanDesc")}
              error={null}
              onBack={() => setScanning(false)}
              onScan={(text) => {
                try {
                  const d = JSON.parse(text) as { address?: string; message?: string; signature?: string };
                  setAddress(d.address ?? "");
                  setMessage(d.message ?? "");
                  setSignature(d.signature ?? "");
                } catch {
                  /* docKind accepted it as JSON */
                }
                setScanning(false);
              }}
            />
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                verify();
              }}
            >
              {/* The message, as the page's subject */}
              <GlowCard>
                <MessageInput value={message} onChange={setMessage} autoFocus />
              </GlowCard>

              {/* Who is said to have signed it, and the signature */}
              <Panel className="flex flex-col divide-y divide-border">
                <div className="p-4">
                  <Field
                    label={t("message.share.address")}
                    error={addr && !isAddress(addr) ? t("message.err.address") : null}
                    hint={known ? t("message.verify.known", { name: known }) : undefined}
                  >
                    {(id) => (
                      <div className="flex items-center gap-2.5">
                        {isAddress(addr) && <AddressAvatar address={addr} size={28} />}
                        <input
                          id={id}
                          className="input h-11 flex-1 font-mono"
                          value={address}
                          placeholder="0x…"
                          onChange={(e) => setAddress(e.target.value)}
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </div>
                    )}
                  </Field>
                </div>
                <div className="p-4">
                  <Field label={t("message.share.signature")}>
                    {(id) => (
                      <input
                        id={id}
                        className="input h-11 font-mono"
                        value={signature}
                        placeholder="0x…"
                        onChange={(e) => setSignature(e.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    )}
                  </Field>
                </div>
              </Panel>

              {error && <Notice tone="critical">{error}</Notice>}
              <div className="flex justify-center gap-3">
                <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={() => setScanning(true)}>
                  <ScanLine className="size-4" />
                  {t("message.verify.scan")}
                </button>
                <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!ready}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <FileCheck className="size-4" />}
                  {t("message.verify.cta")}
                  {!busy && <ArrowRight className="size-4" />}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * VerifyResult answers, as Send's review shows a recipient: who signed it,
 * large, by name when this wallet knows them, the address under it.
 */
function VerifyResult({
  check,
  signerName,
  onBack,
  onAgain,
}: {
  check: MessageCheck & { address: string; message: string };
  signerName: string | null;
  onBack: () => void;
  onAgain: () => void;
}) {
  const t = useT();
  const who = check.valid ? check.address : check.recovered;
  return (
    <>
      <GlowCard>
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          {check.valid ? (
            <span className="scale-125">
              <DrawnCheck />
            </span>
          ) : (
            // The valid check's counterpart: a solid red disc, its cross springing in as the check draws
            <span className="scale-125">
              <motion.span
                className="grid size-8 place-items-center rounded-full bg-critical text-white shadow-[0_0_20px_-4px_var(--critical)]"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", bounce: 0.35, visualDuration: 0.45 }}
                aria-hidden
              >
                <X className="size-[18px]" strokeWidth={3} />
              </motion.span>
            </span>
          )}
          <div className="flex flex-col items-center gap-1.5">
            <h2 className="text-3xl font-semibold tracking-tight">
              {check.valid ? t("message.verify.valid") : t("message.verify.invalid")}
            </h2>
            <p className="max-w-md text-muted-foreground">
              {check.valid
                ? t("message.verify.validLead")
                : t("message.verify.invalidLead", { address: shortHex(check.address, 8, 6) })}
            </p>
          </div>
          <span className="flex items-center gap-3.5 rounded-2xl bg-muted px-5 py-3.5">
            <AddressAvatar address={who} size={40} />
            {signerName ? (
              <span className="flex min-w-0 flex-col items-start">
                <span className="max-w-full truncate text-2xl font-semibold tracking-tight">{signerName}</span>
                <span className="selectable font-mono text-sm text-muted-foreground">{shortHex(who, 10, 8)}</span>
              </span>
            ) : (
              <Address value={who} className="text-left text-[15px] leading-relaxed" />
            )}
          </span>
        </div>
      </GlowCard>
      <Rows as="dl">
        <div className="flex flex-col gap-1.5 px-5 py-3">
          <dt>{t("message.share.message")}</dt>
          <dd className="selectable rounded-xl bg-muted/60 p-3 break-words whitespace-pre-wrap text-muted-foreground">
            {check.message}
          </dd>
        </div>
      </Rows>
      <div className="flex justify-center gap-3">
        <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("common.back")}
        </button>
        <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={onAgain}>
          {t("message.verify.another")}
        </button>
      </div>
    </>
  );
}
