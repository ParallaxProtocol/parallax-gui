import { ReactNode, useEffect, useState } from "react";
import { Ban, Loader2, Zap } from "lucide-react";
import { api, ReplaceKind, ReplaceQuote, SentTx, walletError } from "../../lib/api";
import { formatGwei, formatInt, formatLax } from "../../lib/format";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { Field, PasswordInput } from "./common";

/**
 * ReplaceModal speeds up or cancels a transaction the account has waiting
 * in the pool: a new one at the same nonce, paying enough more for the
 * network to take it instead. It quotes the replacement on opening, and
 * signs it with the wallet password.
 */
export function ReplaceModal({
  target,
  onClose,
  onReplaced,
}: {
  target: { from: string; hash: string; kind: ReplaceKind } | null;
  onClose: () => void;
  onReplaced: (tx: SentTx) => void;
}) {
  const t = useT();
  const [quote, setQuote] = useState<ReplaceQuote | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuote(null);
    setError(null);
    setPassword("");
    if (!target) return;
    let alive = true;
    api
      .walletQuoteReplace(target.from, target.hash, target.kind)
      .then((q) => alive && setQuote(q))
      .catch((e: unknown) => alive && setError(walletError(e, t)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const cancel = target?.kind === "cancel";

  const go = async () => {
    if (!quote || busy || !password || !quote.sufficient) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await api.walletReplace({
        from: quote.from,
        hash: quote.hash,
        kind: quote.kind,
        gasPriceWei: quote.gasPriceWei,
        password,
      });
      setPassword("");
      onReplaced(tx);
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={cancel ? t("wallet.replace.cancelTitle") : t("wallet.replace.speedUpTitle")}
      subtitle={quote ? t("offline.pending.nonce", { n: formatInt(quote.nonce) }) : undefined}
      icon={cancel ? <Ban className="size-4" /> : <Zap className="size-4" />}
    >
      {target && (
        <ModalForm
          onSubmit={go}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t("common.back")}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !quote || !password || !quote.sufficient}
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {cancel ? t("wallet.replace.cancelCta") : t("wallet.replace.speedUpCta")}
              </button>
            </>
          }
        >
          <p className="text-muted-foreground">
            {cancel ? t("wallet.replace.cancelDesc") : t("wallet.replace.speedUpDesc")}
          </p>
          {!quote ? (
            !error && (
              <div className="flex justify-center py-4 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )
          ) : (
            <>
              <dl className="space-y-2 rounded-xl bg-muted px-4 py-3 text-sm tabular-nums">
                <Row label={t("mempool.gasPrice")}>
                  <span className="text-muted-foreground line-through">{formatGwei(quote.oldPriceWei)}</span>{" "}
                  {formatGwei(quote.gasPriceWei)}
                </Row>
                <Row label={t("mempool.maxFee")}>
                  <span className="text-muted-foreground line-through">{formatLax(quote.oldFeeWei, 8)}</span>{" "}
                  {formatLax(quote.feeWei, 8)} LAX
                </Row>
                <Row label={t("mempool.value")}>{formatLax(quote.valueWei, 18)} LAX</Row>
              </dl>
              {!quote.sufficient && <Notice tone="critical">{t("wallet.err.insufficient")}</Notice>}
              <Field label={t("wallet.walletPassword")} hint={t("wallet.review.passwordHint")}>
                {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
              </Field>
              <p className="text-sm text-muted-foreground">{t("wallet.replace.race")}</p>
            </>
          )}
          {error && <Notice tone="critical">{error}</Notice>}
        </ModalForm>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
