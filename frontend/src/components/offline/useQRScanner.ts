import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { cameraAccess } from "../../lib/api";
import { useT } from "../../i18n";

/** How often a frame is decoded, in ms: often enough to feel instant, rarely enough to stay cool. */
const SCAN_EVERY_MS = 120;
/** Frames are decoded at most this wide: QR codes on a screen need no more. */
const DECODE_WIDTH = 960;

export type ScanState = "starting" | "scanning" | "denied" | "none";

/**
 * useQRScanner reads a QR code from the camera, for whichever layout
 * shows it (QRScanner, or a Settings page's own): the video and canvas to
 * attach, the camera's state, the cameras to choose from, and the same
 * text taken from a file or the clipboard where there is no camera.
 * `accept` decides what counts: a code it refuses is reported (refused)
 * and scanning goes on; the first it takes goes to onScan, once.
 */
export function useQRScanner({
  accept,
  onScan,
}: {
  /** null to take the text, or why not. */
  accept: (text: string) => string | null;
  onScan: (text: string) => void;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [state, setState] = useState<ScanState>("starting");
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

  return { video, canvas, fileInput, cameras, deviceId, setDeviceId, state, refused, fromFile, fromClipboard };
}
