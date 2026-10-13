import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, Loader2, ShieldAlert } from "lucide-react";
import { api, onEvent } from "../../lib/api";
import { SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { Label, Plate } from "../../components/ui/Plate";
import { Meter, Notice } from "../../components/ui/bits";

/**
 * HashwarpSetup installs the GPU mining engine: pick a GPU brand, watch
 * the download through its steps, and recover when Windows Defender
 * removes the binary, by adding an exclusion automatically or by hand.
 */
export default function HashwarpSetup({
  onInstalled,
  avBlocked,
  setAvBlocked,
}: {
  onInstalled: () => void;
  avBlocked: boolean;
  setAvBlocked: (v: boolean) => void;
}) {
  const t = useT();
  const [installing, setInstalling] = useState(false);
  const [step, setStep] = useState("");
  const [installErr, setInstallErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pendingGpu, setPendingGpu] = useState<"cuda" | "opencl" | null>(null);
  const [fixingAv, setFixingAv] = useState(false);
  const isWindows = navigator.userAgent.includes("Windows");

  // Whether the backend flagged AV during this install attempt
  const avBlockedRef = useRef(false);

  useEffect(() => {
    return onEvent<{ step: string; detail: string }>("hashwarp-install", (data) => {
      if (data.step === "av-blocked") {
        avBlockedRef.current = true;
        setAvBlocked(true);
        return;
      }
      setStep(
        data.step === "finding"
          ? t("hashwarp.step.finding")
          : data.step === "downloading"
            ? t("hashwarp.step.downloading", { detail: data.detail })
            : data.step === "extracting"
              ? t("hashwarp.step.extracting")
              : data.step === "verifying"
                ? t("hashwarp.step.verifying")
                : data.step === "done"
                  ? t("hashwarp.step.done")
                  : data.step,
      );
      if (data.step === "done") setDone(true);
    });
  }, [setAvBlocked, t]);

  const install = async (gpuType: "cuda" | "opencl") => {
    setInstalling(true);
    setInstallErr(null);
    setAvBlocked(false);
    avBlockedRef.current = false;
    setStep(t("hashwarp.step.starting"));
    setDone(false);
    setPendingGpu(gpuType);
    try {
      await api.installHashwarp(gpuType);
      setTimeout(onInstalled, 1000);
    } catch (e: any) {
      if (!avBlockedRef.current) setInstallErr(e?.message || String(e));
    }
  };

  const fixAndRetry = async () => {
    if (!pendingGpu) return;
    setFixingAv(true);
    try {
      await api.addDefenderExclusion();
      setAvBlocked(false);
      avBlockedRef.current = false;
      setInstalling(true);
      setInstallErr(null);
      setStep(t("hashwarp.step.starting"));
      setDone(false);
      await api.installHashwarp(pendingGpu);
      setTimeout(onInstalled, 1000);
    } catch (e: any) {
      if (!avBlockedRef.current) setInstallErr(e?.message || String(e));
    } finally {
      setFixingAv(false);
    }
  };

  const view = avBlocked ? "av" : installing ? "installing" : "pick";

  return (
    <Plate tone={avBlocked ? "critical" : null} className="p-6">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRING}
          className="flex flex-col gap-5"
        >
          {view === "av" && (
            <>
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-critical-ink" />
                <div>
                  <Label className="text-critical-ink">{t("hashwarp.av.eyebrow")}</Label>
                  <p className="mt-1 text-lg font-medium">{t("hashwarp.av.title")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("hashwarp.av.desc1")}{" "}
                    <strong className="text-foreground">{t("hashwarp.av.falsePositive")}</strong>{" "}
                    {t("hashwarp.av.desc2")}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-3 rounded-md border border-brand/40 bg-brand-muted/40 p-4">
                  <div className="text-sm font-medium">{t("hashwarp.av.autoTitle")}</div>
                  <p className="text-xs text-muted-foreground">{t("hashwarp.av.autoDesc")}</p>
                  <div className="mt-auto">
                    <button className="btn btn-primary btn-sm" onClick={fixAndRetry} disabled={fixingAv}>
                      {fixingAv && <Loader2 className="size-3.5 animate-spin" />}
                      {fixingAv ? t("hashwarp.av.adding") : t("hashwarp.av.addAndRetry")}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-4">
                  <div className="text-sm font-medium">{t("hashwarp.av.manualTitle")}</div>
                  <ol className="list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
                    <li>
                      {t("hashwarp.av.step1a")} <strong className="text-foreground">{t("hashwarp.av.step1b")}</strong>{" "}
                      {t("hashwarp.av.step1c")}
                    </li>
                    <li>
                      {t("hashwarp.av.step2a")} <strong className="text-foreground">{t("hashwarp.av.step2b")}</strong> →{" "}
                      <strong className="text-foreground">{t("hashwarp.av.step2c")}</strong>
                    </li>
                    <li>
                      {t("hashwarp.av.step3a")} <strong className="text-foreground">{t("hashwarp.av.step3b")}</strong> →{" "}
                      <strong className="text-foreground">{t("hashwarp.av.step3c")}</strong>
                    </li>
                    <li>
                      {t("hashwarp.av.step4a")} <strong className="text-foreground">{t("hashwarp.av.step4b")}</strong> →{" "}
                      {t("hashwarp.av.step4c")} <strong className="text-foreground">{t("hashwarp.av.step4d")}</strong> →{" "}
                      {t("hashwarp.av.step4e")}
                    </li>
                    <li>{t("hashwarp.av.step5")}</li>
                  </ol>
                  <div className="mt-auto">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setAvBlocked(false);
                        if (pendingGpu) install(pendingGpu);
                      }}
                    >
                      {t("hashwarp.av.retry")}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAvBlocked(false);
                    setInstalling(false);
                    setPendingGpu(null);
                  }}
                >
                  {t("hashwarp.av.back")}
                </button>
              </div>
            </>
          )}

          {view === "installing" && (
            <>
              <Label>{t("hashwarp.installing.eyebrow")}</Label>
              <div className="flex items-center gap-3">
                {done ? (
                  <span className="brand-gradient grid size-6 place-items-center rounded-full text-brand-foreground">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                ) : installErr ? null : (
                  <Loader2 className="size-5 animate-spin text-brand" />
                )}
                <span className="text-sm">{step}</span>
              </div>
              {!done && !installErr && <Meter />}
              {installErr && (
                <>
                  <Notice tone="critical">{installErr}</Notice>
                  <div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setInstalling(false)}>
                      {t("hashwarp.installing.back")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {view === "pick" && (
            <>
              <div>
                <Label>{t("hashwarp.setup.eyebrow")}</Label>
                <p className="mt-1 text-lg font-medium">{t("hashwarp.setup.title")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t("hashwarp.setup.desc")}</p>
              </div>
              {isWindows && (
                <Notice tone="info">
                  <strong>{t("hashwarp.setup.winNoteBold")}</strong> {t("hashwarp.setup.winNote")}
                </Notice>
              )}
              <div className="grid grid-cols-2 gap-4">
                <GpuCard
                  brand="NVIDIA"
                  series={t("hashwarp.setup.nvidiaSeries")}
                  cta={t("hashwarp.setup.downloadCuda")}
                  onClick={() => install("cuda")}
                />
                <GpuCard
                  brand="AMD"
                  series={t("hashwarp.setup.amdSeries")}
                  cta={t("hashwarp.setup.downloadOpenCl")}
                  onClick={() => install("opencl")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {isWindows ? (
                  t("hashwarp.setup.winHint")
                ) : (
                  <>
                    {t("hashwarp.setup.linuxHintA")}{" "}
                    <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground">lspci | grep -i vga</code>{" "}
                    {t("hashwarp.setup.linuxHintB")}
                  </>
                )}
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </Plate>
  );
}

function GpuCard({ brand, series, cta, onClick }: { brand: string; series: string; cta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col items-start gap-1 rounded-md border border-border bg-background p-5 text-left transition-colors hover:border-brand/50"
    >
      <span className="text-base font-semibold tracking-tight">{brand}</span>
      <span className="text-xs text-muted-foreground">{series}</span>
      <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand transition-[gap] group-hover:gap-2.5">
        <Download className="size-3.5" />
        {cta}
      </span>
    </button>
  );
}
