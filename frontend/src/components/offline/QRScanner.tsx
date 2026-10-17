import { ArrowLeft, Camera, ClipboardPaste, FileUp, Loader2, OctagonAlert, VideoOff } from "lucide-react";
import { useT } from "../../i18n";
import { Select } from "../ui/Select";
import { GlowCard } from "../ui/GlowCard";
import { CardRow, CardRows } from "../ui/CardRow";
import { useQRScanner } from "./useQRScanner";

/**
 * QRScanner reads a QR code from the camera, for the documents of offline
 * signing. `accept` decides what counts: a code it refuses is reported and
 * scanning goes on. Where there is no camera, or it isn't allowed, the
 * same text can come from a file or the clipboard.
 */
export function QRScanner({
  accept,
  onScan,
  hint,
}: {
  /** null to take the text, or why not. */
  accept: (text: string) => string | null;
  onScan: (text: string) => void;
  hint?: string;
}) {
  const t = useT();
  const { video, canvas, fileInput, cameras, deviceId, setDeviceId, state, refused, fromFile, fromClipboard } =
    useQRScanner({ accept, onScan });

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl bg-black">
        <video ref={video} className="size-full object-cover" playsInline muted />
        <canvas ref={canvas} className="hidden" />
        {state === "scanning" && (
          // The frame to aim the code into
          <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/35%)]" />
        )}
        {state !== "scanning" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
            {state === "starting" ? <Loader2 className="size-6 animate-spin" /> : <VideoOff className="size-7" />}
            <p className="max-w-xs text-sm">
              {state === "starting"
                ? t("offline.scan.starting")
                : state === "denied"
                  ? t("offline.scan.denied")
                  : t("offline.scan.noCamera")}
            </p>
          </div>
        )}
      </div>
      {refused ? (
        <p className="text-sm text-critical-ink" role="alert">
          {refused}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Camera className="size-3.5" />
          {hint ?? t("offline.scan.hint")}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {cameras.length > 1 && (
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
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => fromFile(e.target.files?.[0])}
        />
        <button type="button" className="btn btn-flat btn-sm" onClick={() => fileInput.current?.click()}>
          <FileUp className="size-3.5" />
          {t("offline.scan.file")}
        </button>
        <button type="button" className="btn btn-flat btn-sm" onClick={fromClipboard}>
          <ClipboardPaste className="size-3.5" />
          {t("offline.scan.paste")}
        </button>
      </div>
    </div>
  );
}

/**
 * ScanCard is a scanning step, laid out as the app's other steps are: the
 * camera as the page's subject in a glowing card, under its title and
 * what to hold up to it, what was wrong with the last code at its foot,
 * and Back under the card.
 */
export function ScanCard({
  title,
  desc,
  error,
  accept,
  onScan,
  hint,
  onBack,
}: {
  title: string;
  desc: string;
  error?: string | null;
  accept: (text: string) => string | null;
  onScan: (text: string) => void;
  hint?: string;
  onBack?: () => void;
}) {
  const t = useT();
  return (
    <>
      <GlowCard>
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="max-w-md text-muted-foreground">{desc}</p>
          </div>
          <div className="w-full">
            <QRScanner accept={accept} onScan={onScan} hint={hint} />
          </div>
        </div>
        <CardRows className="mt-4">
          {error && <CardRow tone="critical" icon={OctagonAlert} title={t("offline.scan.failedTitle")} desc={error} />}
        </CardRows>
      </GlowCard>
      {onBack && (
        <div className="flex justify-center">
          <button type="button" className="btn btn-secondary btn-lg min-w-36" onClick={onBack}>
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </button>
        </div>
      )}
    </>
  );
}
