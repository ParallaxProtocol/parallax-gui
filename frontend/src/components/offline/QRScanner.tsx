import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { ArrowLeft, Camera, ClipboardPaste, FileUp, Loader2, VideoOff } from "lucide-react";
import { cameraAccess } from "../../lib/api";
import { useT } from "../../i18n";
import { Select } from "../ui/Select";
import { GlowCard } from "../ui/GlowCard";
import { Notice } from "../ui/bits";

/** How often a frame is decoded, in ms: often enough to feel instant, rarely enough to stay cool. */
const SCAN_EVERY_MS = 120;
/** Frames are decoded at most this wide: QR codes on a screen need no more. */
const DECODE_WIDTH = 960;

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
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [state, setState] = useState<"starting" | "scanning" | "denied" | "none">("starting");
  const [refused, setRefused] = useState<string | null>(null);
  const done = useRef(false);
  const accepts = useRef(accept);
  accepts.current = accept;
  const scanned = useRef(onScan);
  scanned.current = onScan;

  // One text, once: the first the caller accepts
  const take = (text: string) => {
    if (done.current) return;
    const why = accepts.current(text);
    if (why) {
      setRefused(why);
      return;
    }
    done.current = true;
    scanned.current(text);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let last = 0;
    let alive = true;

    const start = async () => {
      setState("starting");
      const media = navigator.mediaDevices as MediaDevices | undefined;
      if (!media) {
        if (alive) setState("none");
        return;
      }
      if (!(await cameraAccess())) {
        if (alive) setState("denied");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (!alive) return;
        const name = (e as DOMException)?.name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
        return;
      }
      if (!alive || !video.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setState("scanning");
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => alive && setCameras(d.filter((x) => x.kind === "videoinput")))
        .catch(() => {});

      const tick = (now: number) => {
        if (!alive || done.current) return;
        frame = requestAnimationFrame(tick);
        if (now - last < SCAN_EVERY_MS) return;
        last = now;
        const v = video.current;
        const c = canvas.current;
        if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
        const scale = Math.min(1, DECODE_WIDTH / v.videoWidth);
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) take(code.data);
      };
      frame = requestAnimationFrame(tick);
    };
    start();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const fromFile = async (f: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!f) return;
    if (f.size > 8 * 1024) return setRefused(t("offline.scan.tooBig"));
    take((await f.text()).trim());
  };
  const fromClipboard = async () => {
    try {
      take((await navigator.clipboard.readText()).trim());
    } catch {
      setRefused(t("offline.scan.noClipboard"));
    }
  };

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
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()}>
          <FileUp className="size-3.5" />
          {t("offline.scan.file")}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={fromClipboard}>
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
 * what to hold up to it, and Back under the card.
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
          {error && (
            <div className="w-full text-left">
              <Notice tone="critical">{error}</Notice>
            </div>
          )}
          <div className="w-full">
            <QRScanner accept={accept} onScan={onScan} hint={hint} />
          </div>
        </div>
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
