import { useEffect, useState, type ReactNode } from "react";
import { Delete, Loader2, Usb } from "lucide-react";
import { api, walletError, type HardwareDevice, type HardwareKind, type SeedScheme } from "../../lib/api";
import { useT } from "../../i18n";
import { Notice } from "../ui/bits";
import { Panel } from "../ui/Panel";
import { Indicator, type Grade } from "../ui/Indicator";

/** The devices' own names, the same in every language. */
export const DEVICE_NAME: Record<HardwareKind, string> = { ledger: "Ledger", trezor: "Trezor" };

/**
 * firstScheme is the path a device's accounts are looked along first: a
 * Ledger's where Ledger Live (and MetaMask, with a Ledger) put them, a
 * Trezor's where Trezor Suite does, the standard one.
 */
export function firstScheme(kind: HardwareKind): SeedScheme {
  return kind === "ledger" ? "ledgerlive" : "standard";
}

/** How often the devices are looked at while a page shows them (ms). */
const POLL_MS = 1000;

/**
 * useHardwareDevices lists the Ledgers and Trezors connected, read again
 * every second while enabled: the backend opens a Trezor first seen (it
 * asks for its PIN then) and asks a Ledger for an address, which tells
 * whether it is unlocked with its Ethereum app open. Error is the backend
 * failing to look (a build without USB), said in the user's language.
 */
export function useHardwareDevices(enabled = true) {
  const t = useT();
  const [devices, setDevices] = useState<HardwareDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const list = await api.hardwareDevices();
        if (!alive) return;
        setDevices(list);
        setError(null);
      } catch (e) {
        if (alive) setError(walletError(e, t));
      }
      if (alive) timer = setTimeout(read, POLL_MS);
    };
    read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { devices, error };
}

/** deviceOf picks the device of a kind to show: one ready to sign if there is, else the first. */
export function deviceOf(devices: HardwareDevice[] | null, kind?: HardwareKind): HardwareDevice | null {
  const mine = (devices ?? []).filter((d) => !kind || d.kind === kind);
  return mine.find((d) => d.state === "ready") ?? mine[0] ?? null;
}

const GRADE: Record<HardwareDevice["state"], Grade> = {
  ready: "good",
  locked: "warn",
  app: "warn",
  pin: "warn",
  passphrase: "warn",
  confirm: "info",
  busy: "info",
  access: "critical",
  error: "critical",
};

/**
 * DeviceStatus says where a device stands, as a panel: what it is doing
 * and, while it waits on the user, what to do, with the PIN pad or
 * passphrase field a Trezor One asks for here and, on a Linux that won't
 * let the app open it, the way to set up USB access. With none connected
 * it says to connect one (of kind, if given).
 */
export function DeviceStatus({
  device,
  kind,
  error,
}: {
  device: HardwareDevice | null;
  kind?: HardwareKind;
  /** The backend failing to look for devices at all. */
  error?: string | null;
}) {
  const t = useT();
  if (error) return <Notice tone="critical">{error}</Notice>;
  const name = DEVICE_NAME[device?.kind ?? kind ?? "ledger"];
  if (!device) {
    return (
      <StatusPanel grade="off" title={kind ? t("hardware.state.none", { device: name }) : t("hardware.state.noneAny")}>
        {t("hardware.state.noneDesc")}
      </StatusPanel>
    );
  }
  const title = t(`hardware.state.${device.state}`, { device: name });
  const desc = t(`hardware.state.${device.state}Desc`, { device: name });
  return (
    <StatusPanel grade={GRADE[device.state]} title={title} busy={device.state === "confirm" || device.state === "busy"}>
      {desc}
      {device.error && device.state !== "access" && <span className="text-critical-ink"> {device.error}</span>}
      {device.state === "pin" && <PinPad device={device} />}
      {device.state === "passphrase" && <PassphraseForm device={device} />}
      {device.state === "access" && device.setupUsb && <SetupUSB />}
    </StatusPanel>
  );
}

function StatusPanel({
  grade,
  title,
  busy,
  children,
}: {
  grade: Grade;
  title: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Panel className="flex items-start gap-3.5 p-4">
      <Usb className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          {busy ? <Loader2 className="size-3.5 animate-spin text-info-ink" /> : <Indicator grade={grade} />}
          {title}
        </span>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">{children}</div>
      </div>
    </Panel>
  );
}

/**
 * PinPad takes a Trezor One's PIN as it asks for it: its screen shows the
 * digits shuffled on a three by three grid, and the pad here is the same
 * grid blank, so the PIN never shows on the computer. Each press is a
 * position, numbered as a numeric keypad's keys (7 8 9 along the top).
 */
function PinPad({ device }: { device: HardwareDevice }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPin(""), []);
  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.hardwareUnlock(device.id, pin);
      setPin("");
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col items-start gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("hardware.pin.pad")}>
        {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            className="btn btn-secondary size-12 p-0"
            aria-label={t("hardware.pin.position", { n })}
            onClick={() => setPin((p) => (p.length < 50 ? p + n : p))}
          >
            <span className="size-2 rounded-full bg-foreground/60" aria-hidden />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-24 font-mono text-lg tracking-widest text-foreground" aria-live="polite">
          {"•".repeat(pin.length) || (
            <span className="text-sm tracking-normal text-muted-foreground">{t("hardware.pin.empty")}</span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          disabled={!pin}
          aria-label={t("hardware.pin.delete")}
          onClick={() => setPin((p) => p.slice(0, -1))}
        >
          <Delete className="size-3.5" />
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!pin || busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("hardware.unlock")}
        </button>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </form>
  );
}

/** PassphraseForm takes a Trezor One's passphrase; left empty, it opens the wallet without one. */
function PassphraseForm({ device }: { device: HardwareDevice }) {
  const t = useT();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setPassphrase(""), []);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.hardwareUnlock(device.id, passphrase);
          setPassphrase("");
        } catch (err) {
          setError(walletError(err, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          className="input min-w-0 flex-1"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          aria-label={t("wallet.passphrase.label")}
          autoComplete="off"
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("hardware.unlock")}
        </button>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </form>
  );
}

/** SetupUSB installs the udev rules Linux needs, behind the system's password prompt. */
function SetupUSB() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <span>{t("hardware.setup.done")}</span>;
  return (
    <div className="flex flex-col items-start gap-2">
      <span>{t("hardware.setup.desc")}</span>
      <button
        type="button"
        className="btn btn-tinted btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.hardwareSetupUSB();
            setDone(true);
          } catch (e) {
            setError(walletError(e, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {t("hardware.setup.cta")}
      </button>
      {error && <Notice tone="critical">{error}</Notice>}
    </div>
  );
}

/**
 * SignOnDevice is what to do while a device waits for the user to confirm
 * what it was sent: check it there against the page, then approve it.
 * The devices run their Ethereum apps, which may not know Parallax by name.
 */
export function SignOnDevice({ kind, message }: { kind: HardwareKind; message?: boolean }) {
  const t = useT();
  const device = DEVICE_NAME[kind];
  return (
    <Notice tone="info" title={t("hardware.confirm.title", { device })}>
      {message ? t("hardware.confirm.message", { device }) : t("hardware.confirm.tx", { device })}
    </Notice>
  );
}

/**
 * HardwareReady is the status of the device a hardware wallet account's
 * send needs, read while the page shows it, with nothing said once that
 * device is ready: the button's confirm step then says the rest.
 */
export function HardwareReady({ kind, active }: { kind: HardwareKind; active: boolean }) {
  const { devices, error } = useHardwareDevices(active);
  const device = deviceOf(devices, kind);
  if (devices === null && !error) return null;
  if (device?.state === "ready" || device?.state === "busy") return null;
  return <DeviceStatus device={device} kind={kind} error={error} />;
}
