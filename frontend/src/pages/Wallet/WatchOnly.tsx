import { Loader2, Trash2 } from "lucide-react";
import { api, WalletAccount } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { useBusy } from "./accountActions";

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
