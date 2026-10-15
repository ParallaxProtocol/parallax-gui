import { useState } from "react";
import { Eye, Loader2, ScanLine, VideoOff } from "lucide-react";
import { api } from "../../../lib/api";
import { isAddress } from "../../../lib/format";
import { scannedAddress } from "../../../lib/offline";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { Rows } from "../../../components/ui/Panel";
import { Modal, ModalForm } from "../../../components/ui/Modal";
import { Select } from "../../../components/ui/Select";
import { AddressAvatar } from "../../../components/ui/AddressAvatar";
import { useQRScanner } from "../../../components/offline/useQRScanner";
import { useBusy, useDefaultName } from "../../Wallet/accountActions";
import { Group } from "../fields";
import { FieldRow, SettingsFlow, Step, StepFooter } from "./flow";

/**
 * AddWatchOnly follows an account whose key is on an offline signer, laid
 * out as a Settings section: its address, typed or pasted, or scanned from
 * the signer's Receive screen in a modal over the page. It takes the next
 * Account N, renamed in the list.
 */
export function AddWatchOnly({ lead, onLeave, onDone }: { lead: string; onLeave: () => void; onDone: () => void }) {
  const t = useT();
  const defaultName = useDefaultName();
  const wallet = useWallet();
  const [address, setAddress] = useState("");
  const [scanning, setScanning] = useState(false);
  const { busy, error, run } = useBusy();
  const addr = address.trim();
  const ok = isAddress(addr);

  return (
    <SettingsFlow title={t("offline.watch.title")} steps={[lead, t("wallet.create.step.details")]} current={1}>
      <Step
        onSubmit={async () => {
          if (!ok || busy) return;
          const acc = await run(() => api.walletAddWatchOnly(defaultName, addr));
          if (acc) {
            await wallet.refresh();
            onDone();
          }
        }}
      >
        <Group title={t("contacts.address")} desc={t("offline.watch.desc")}>
          <Rows>
            <FieldRow
              label={t("contacts.address")}
              desc={t("offline.watch.addressHint")}
              error={addr && !ok ? t("wallet.err.badRecipient") : null}
              wide
            >
              {(id) => (
                <div className="flex items-center gap-2">
                  {ok && <AddressAvatar address={addr} size={28} />}
                  <input
                    id={id}
                    className="input min-w-0 flex-1 font-mono"
                    placeholder="0x…"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
                  />
                  <button type="button" className="btn btn-tinted btn-sm shrink-0" onClick={() => setScanning(true)}>
                    <ScanLine className="size-3.5" />
                    {t("offline.watch.scan")}
                  </button>
                </div>
              )}
            </FieldRow>
          </Rows>
          {error && <Notice tone="critical">{error}</Notice>}
        </Group>
        <StepFooter onBack={onLeave}>
          <button type="submit" className="btn btn-primary" disabled={!ok || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            {t("offline.watch.cta")}
          </button>
        </StepFooter>
      </Step>
      <ScanModal
        open={scanning}
        onClose={() => setScanning(false)}
        onScan={(found) => {
          setAddress(found);
          setScanning(false);
        }}
      />
    </SettingsFlow>
  );
}

/**
 * ScanModal reads an address from the camera, over the page that wants it:
 * what to hold up, the picture with the frame to aim the code into, which
 * camera where there are several, and Cancel. The first code that is an
 * address goes to onScan; one that isn't is said so, and scanning goes on.
 */
function ScanModal({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (address: string) => void;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={t("offline.watch.scan")} icon={<ScanLine className="size-4" />}>
      {open && <Scan onClose={onClose} onScan={onScan} />}
    </Modal>
  );
}

function Scan({ onClose, onScan }: { onClose: () => void; onScan: (address: string) => void }) {
  const t = useT();
  const { video, canvas, cameras, deviceId, setDeviceId, state, refused } = useQRScanner({
    accept: (text) => (scannedAddress(text) ? null : t("offline.scan.notAddress")),
    onScan: (text) => onScan(scannedAddress(text) ?? ""),
  });
  return (
    <ModalForm
      // Nothing to submit: a code is taken as soon as it is seen
      onSubmit={() => {}}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>
          {t("common.cancel")}
        </button>
      }
    >
      <p className="text-muted-foreground">{t("offline.watch.scanHint")}</p>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
        <video ref={video} className="size-full object-cover" playsInline muted />
        <canvas ref={canvas} className="hidden" />
        {state === "scanning" ? (
          // The frame to aim the code into
          <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/35%)]" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
            {state === "starting" ? <Loader2 className="size-6 animate-spin" /> : <VideoOff className="size-7" />}
            <p className="max-w-xs text-sm">
              {state === "starting"
                ? t("offline.scan.starting")
                : state === "denied"
                  ? t("offline.watch.scanDenied")
                  : t("offline.watch.scanNone")}
            </p>
          </div>
        )}
      </div>
      {refused && <Notice tone="critical">{refused}</Notice>}
      {cameras.length > 1 && (
        <div className="flex items-center justify-between gap-4">
          <span>{t("offline.scan.camera")}</span>
          <Select<string>
            className="w-56"
            aria-label={t("offline.scan.camera")}
            value={deviceId || cameras[0]?.deviceId || ""}
            onChange={setDeviceId}
            options={cameras.map((c, i) => ({
              value: c.deviceId,
              label: c.label || t("offline.scan.cameraN", { n: i + 1 }),
            }))}
          />
        </div>
      )}
    </ModalForm>
  );
}
