import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  api,
  walletError,
  type HardwareDevice,
  type HardwareKind,
  type HardwareWalletInfo,
  type SeedCandidate,
  type SeedPick,
  type SeedScheme,
} from "../../../lib/api";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { RadioMark } from "../../../components/ui/Choice";
import {
  DEVICE_NAME,
  DeviceStatus,
  deviceOf,
  firstScheme,
  useHardwareDevices,
} from "../../../components/hardware/Device";
import { useBusy, useNamePicks } from "../../Wallet/accountActions";
import { type Found, pickKey, picksOf } from "../../Wallet/PhraseImport";
import { Group } from "../fields";
import { SettingsFlow, Step, StepFooter, useDrillBack } from "./flow";
import { BATCH, PhrasePicker } from "./Picker";

/**
 * HardwareImport brings in accounts whose keys stay on a Ledger or a
 * Trezor: the device, connected and unlocked (a Ledger with its Ethereum
 * app open), then the accounts it holds along the paths wallets use, with
 * what each holds on chain, to pick, as a phrase's are. The wallet keeps
 * their addresses and paths only; every send from them is confirmed on the
 * device. The first accounts are read from the device as it is chosen.
 */
export function HardwareImport({ lead, onBack, onDone }: { lead: string; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const namePicks = useNamePicks();
  const wallet = useWallet();
  const [stage, setStage] = useState<"connect" | "accounts">("connect");
  const [chosen, setChosen] = useState<string | null>(null);
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useBusy();
  // Read while the device is being connected, and while accounts are picked
  // (it may be unplugged or lock itself meanwhile)
  const { devices, error: lookError } = useHardwareDevices();

  const steps = [lead, t("hardware.import.step.connect"), t("wallet.import.step.accounts")];
  const list = devices ?? [];
  const device: HardwareDevice | null = list.find((d) => d.id === chosen) ?? deviceOf(list);

  /** scan reads the next batch of a scheme from the device, and picks the used accounts in it. */
  const scan = async (scheme: SeedScheme, from: number) => {
    if (!device) return [];
    const batch = await api.hardwareScan(device.id, scheme, from, BATCH);
    setFound((f) => ({
      ...f,
      [scheme]: [
        ...f[scheme].filter((c) => c.index < from),
        ...batch,
        ...f[scheme].filter((c) => c.index >= from + batch.length),
      ],
    }));
    setPicked((p) => {
      const next = new Set(p);
      for (const c of batch) if (c.used && !c.inWallet) next.add(pickKey(c));
      return next;
    });
    return batch;
  };

  if (stage === "connect" || !device) {
    const ready = device?.state === "ready";
    return (
      <SettingsFlow title={t("hardware.import.title")} steps={steps} current={1}>
        <Step
          onSubmit={async () => {
            if (busy || !ready || !device) return;
            const batch = await run(async () => {
              setChosen(device.id);
              setFound({ standard: [], ledgerlive: [], legacy: [] });
              setPicked(new Set());
              return scan(firstScheme(device.kind), 0);
            });
            if (!batch) return;
            // The first account is always offered, used or not (the same on
            // the standard path and Ledger Live's)
            if (batch[0] && !batch[0].inWallet) setPicked((p) => new Set(p).add(pickKey(batch[0])));
            setStage("accounts");
          }}
        >
          <Group title={t("hardware.import.deviceGroup")} desc={t("hardware.import.deviceDesc")}>
            {list.length > 1 ? (
              // Several plugged in: each its own status, the one to use picked
              list.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="flex items-start gap-3 text-left"
                  aria-pressed={d.id === device?.id}
                  aria-label={t("hardware.import.pick")}
                  onClick={() => setChosen(d.id)}
                >
                  <RadioMark selected={d.id === device?.id} className="mt-5" />
                  <span className="min-w-0 flex-1">
                    <DeviceStatus device={d} />
                  </span>
                </button>
              ))
            ) : (
              <DeviceStatus device={device} error={lookError} />
            )}
          </Group>
          {error && <Notice tone="critical">{error}</Notice>}
          <StepFooter onBack={onBack}>
            <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("common.continue")}
            </button>
          </StepFooter>
        </Step>
      </SettingsFlow>
    );
  }

  const picks = picksOf(found, picked);
  return (
    <SettingsFlow title={t("wallet.import.chooseTitle")} steps={steps} current={2}>
      <Step>
        {device.state !== "ready" && device.state !== "busy" && <DeviceStatus device={device} />}
        <PhrasePicker
          found={found}
          picked={picked}
          pathDesc={t("hardware.import.pathDesc")}
          initialScheme={firstScheme(device.kind)}
          onToggle={(c: SeedCandidate) =>
            setPicked((p) => {
              const next = new Set(p);
              if (next.has(pickKey(c))) next.delete(pickKey(c));
              else next.add(pickKey(c));
              return next;
            })
          }
          onScan={async (scheme, from) => {
            setError(null);
            try {
              await scan(scheme, from);
            } catch (e) {
              setError(walletError(e, t));
            }
          }}
          error={error}
        />
        <StepFooter onBack={() => setStage("connect")} hint={t("wallet.import.picked", { n: picks.length })}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || picks.length === 0}
            onClick={async () => {
              const acc = await run(() => api.hardwareAddAccounts(device.id, namePicks(picks, "")));
              if (acc) {
                await wallet.refresh();
                onDone();
              }
            }}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t("hardware.import.busy") : t("hardware.import.cta")}
          </button>
        </StepFooter>
      </Step>
    </SettingsFlow>
  );
}

/**
 * FindHardwareAccounts brings in more of a hardware wallet's accounts, as
 * FindAccounts does a phrase's: the state of a device of its kind until one
 * holding that wallet is ready (saying so when the one connected holds
 * another), then a PhrasePicker reading it (the first accounts as it
 * opens), its picks added from the accounts' header. With no wallet (the
 * accounts no device has said the wallet of), any device of the kind does.
 * Another device plugged in meanwhile starts the picking over.
 */
export function FindHardwareAccounts({
  kind,
  wallet: hw,
  onLeave,
  onDone,
}: {
  kind: HardwareKind;
  wallet: HardwareWalletInfo | null;
  onLeave: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const wallet = useWallet();
  const namePicks = useNamePicks();
  const { devices, error: lookError } = useHardwareDevices();
  const mine = (devices ?? []).filter((d) => !hw || d.wallet === hw.id);
  const device = deviceOf(mine, kind) ?? deviceOf(devices, kind);
  const ready = device?.state === "ready" || device?.state === "busy";
  useDrillBack(onLeave);

  if (!device || !ready) return <DeviceStatus device={device} kind={kind} error={lookError} />;
  if (hw && device.wallet && device.wallet !== hw.id) {
    // A device that holds another wallet: another phrase, or a Trezor's other passphrase
    return <Notice tone="warn">{t("hardware.find.other", { device: DEVICE_NAME[kind], name: hw.name })}</Notice>;
  }
  return (
    <DevicePicker
      key={device.id}
      device={device}
      onAdd={async (picks) => {
        await api.hardwareAddAccounts(device.id, namePicks(picks, ""));
        await wallet.refresh();
        onDone();
      }}
      addLabel={t("wallet.accounts.add")}
    />
  );
}

/** DevicePicker is the PhrasePicker of one device's accounts, its picks added from the accounts' header. */
function DevicePicker({
  device,
  onAdd,
  addLabel,
}: {
  device: HardwareDevice;
  onAdd: (picks: SeedPick[]) => Promise<void>;
  addLabel: string;
}) {
  const t = useT();
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useBusy();

  const scan = async (s: SeedScheme, from: number) => {
    setError(null);
    try {
      const batch = await api.hardwareScan(device.id, s, from, BATCH);
      setFound((f) => ({
        ...f,
        [s]: [...f[s].filter((c) => c.index < from), ...batch, ...f[s].filter((c) => c.index >= from + batch.length)],
      }));
      setPicked((p) => new Set([...p, ...batch.filter((c) => c.used && !c.inWallet).map(pickKey)]));
    } catch (e) {
      setError(walletError(e, t));
    }
  };
  const picks = picksOf(found, picked);
  return (
    <PhrasePicker
      found={found}
      picked={picked}
      pathDesc={t("hardware.import.pathDesc")}
      initialScheme={firstScheme(device.kind)}
      onToggle={(c: SeedCandidate) =>
        setPicked((p) => {
          const next = new Set(p);
          if (next.has(pickKey(c))) next.delete(pickKey(c));
          else next.add(pickKey(c));
          return next;
        })
      }
      onScan={scan}
      error={error}
      aside={
        <>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("wallet.import.picked", { n: picks.length })}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || picks.length === 0}
            onClick={() => run(() => onAdd(picks))}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {addLabel}
          </button>
        </>
      }
    />
  );
}
