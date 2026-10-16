import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Loader2, ScanLine, Trash2 } from "lucide-react";
import { api, WalletAccount } from "../../lib/api";
import { isAddress } from "../../lib/format";
import { scannedAddress } from "../../lib/offline";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { QRScanner } from "../../components/offline/QRScanner";
import { NameField } from "./AccountForms";
import { useBusy, useDefaultName } from "./accountActions";
import { Field } from "./common";
import { FlowPage, Part, StepFooter, StepPanel } from "./flow";

/**
 * AddWatchOnlyPage follows an account whose key is on an offline signer:
 * its address, scanned from the signer's Receive screen or typed. The
 * wallet then shows its balance and activity, and sends from it by
 * signing request.
 */
export function AddWatchOnlyPage() {
  const t = useT();
  const defaultName = useDefaultName();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [scanning, setScanning] = useState(false);
  const { busy, error, run } = useBusy();
  const addr = address.trim();
  const ok = isAddress(addr);

  return (
    <FlowPage title={t("offline.watch.title")} steps={[]} current={0}>
      <StepPanel
        onSubmit={async () => {
          if (!ok || busy) return;
          const acc = await run(() => api.walletAddWatchOnly(name.trim() || defaultName, addr));
          if (acc) {
            await wallet.refresh();
            navigate("/", { replace: true });
          }
        }}
      >
        <Part>
          <p className="text-sm text-muted-foreground">{t("offline.watch.desc")}</p>
        </Part>
        <Part>
          <NameField value={name} onChange={setName} />
        </Part>
        <Part>
          {scanning ? (
            <QRScanner
              hint={t("offline.watch.scanHint")}
              accept={(text) => (scannedAddress(text) ? null : t("offline.scan.notAddress"))}
              onScan={(text) => {
                setAddress(scannedAddress(text) ?? "");
                setScanning(false);
              }}
            />
          ) : (
            <Field
              label={t("contacts.address")}
              error={addr && !ok ? t("wallet.err.badRecipient") : null}
              hint={t("offline.watch.addressHint")}
            >
              {(id) => (
                <div className="flex items-center gap-2.5">
                  {ok && <AddressAvatar address={addr} size={28} />}
                  <input
                    id={id}
                    className="input flex-1 font-mono"
                    placeholder="0x…"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
                  />
                  <button type="button" className="btn btn-secondary shrink-0" onClick={() => setScanning(true)}>
                    <ScanLine className="size-4" />
                    {t("offline.watch.scan")}
                  </button>
                </div>
              )}
            </Field>
          )}
          {error && <Notice tone="critical">{error}</Notice>}
        </Part>
        <StepFooter onBack={() => (scanning ? setScanning(false) : navigate(-1))}>
          <button type="submit" className="btn btn-primary" disabled={!ok || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            {t("offline.watch.cta")}
          </button>
        </StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

/** RemoveWatchOnlyModal stops following a watch-only account: nothing of its key is here, so no password. */
export function RemoveWatchOnlyModal({
  account,
  label,
  onClose,
}: {
  account: WalletAccount | null;
  label: string;
  onClose: () => void;
}) {
  const t = useT();
  const wallet = useWallet();
  const { busy, error, run } = useBusy();
  return (
    <Modal
      open={!!account}
      onClose={onClose}
      title={t("offline.watch.removeTitle")}
      subtitle={label}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      {account && (
        <ModalForm
          busy={busy}
          onSubmit={async () => {
            const ok = await run(async () => {
              await api.walletRemoveWatchOnly(account.address);
              return true;
            });
            if (ok) {
              await wallet.refresh();
              onClose();
            }
          }}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn btn-danger" disabled={busy} autoFocus>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {t("contacts.remove.cta")}
              </button>
            </>
          }
        >
          <p className="text-muted-foreground">{t("offline.watch.removeDesc")}</p>
          {error && <Notice tone="critical">{error}</Notice>}
        </ModalForm>
      )}
    </Modal>
  );
}
