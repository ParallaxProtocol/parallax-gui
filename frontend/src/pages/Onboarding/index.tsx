import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { api, GUIConfig } from "../../lib/api";
import { SPRING } from "../../lib/motion";
import Toggle from "../../components/ui/Toggle";
import { Label } from "../../components/ui/Plate";
import { Notice } from "../../components/ui/bits";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import logo from "../../assets/logo.svg";

type Step = "language" | "welcome" | "datadir" | "syncmode" | "networking" | "rpc" | "starting";

const STEPS: Step[] = ["language", "welcome", "datadir", "syncmode", "networking", "rpc"];

/**
 * Onboarding is the first-run wizard: a brand panel with the steps on the
 * left, the current step on the right, sliding in the direction of travel.
 */
export default function Onboarding({ onFinished }: { onFinished: () => void }) {
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [step, setStep] = useState<Step>("language");
  const [direction, setDirection] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const { lang, setLang } = useLang();
  const t = useT();

  useEffect(() => {
    api.getConfig().then(setCfg);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<GUIConfig>) => setCfg({ ...cfg, ...patch });
  const index = STEPS.indexOf(step);
  const go = (to: Step) => {
    setDirection(STEPS.indexOf(to) >= index ? 1 : -1);
    setStep(to);
  };
  const next = () => go(STEPS[index + 1]);
  const back = () => go(STEPS[index - 1]);

  const finish = async () => {
    setDirection(1);
    setStep("starting");
    setError(null);
    try {
      await api.saveBootstrap(cfg);
      await api.startNode();
      onFinished();
    } catch (e: any) {
      setError(e?.message || String(e));
      setStep("rpc");
    }
  };

  return (
    <div className="grid h-full grid-cols-[minmax(320px,2fr)_3fr]">
      {/* The brand panel */}
      <aside className="relative flex flex-col overflow-hidden border-r border-border bg-sidebar px-10 py-10">
        {/* Still on purpose: an endless rotation keeps the window redrawing every frame */}
        <img
          src={logo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 size-[420px] -rotate-12 opacity-[0.06]"
        />
        <motion.div
          className="relative flex items-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
        >
          <img src={logo} alt="" className="size-10" />
          <div className="leading-none">
            <div className="text-lg font-semibold tracking-tight">Parallax</div>
            <Label className="mt-1 block text-[9px]">{t("brand.desktop")}</Label>
          </div>
        </motion.div>

        <div className="relative mt-16">
          <Label>{t("onboarding.welcome")}</Label>
          <h1 className="mt-3 text-5xl leading-[1.05]">{t("onboarding.brand")}</h1>
        </div>

        <ol className="relative mt-12 flex flex-col gap-1">
          {STEPS.map((s, i) => {
            const done = i < index || step === "starting";
            const here = s === step;
            return (
              <li key={s} className="relative flex items-center gap-3 py-1.5">
                <span
                  className={`grid size-6 place-items-center rounded-full border font-mono text-[10px] transition-colors duration-300 ${
                    done
                      ? "brand-gradient border-transparent text-brand-foreground"
                      : here
                        ? "border-brand text-brand"
                        : "border-border-strong text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className={`text-sm transition-colors ${here ? "text-foreground" : "text-muted-foreground"}`}>
                  {t(`onboarding.step.${s}`)}
                </span>
                {here && (
                  <motion.span
                    layoutId="onboarding-current"
                    layoutDependency={step}
                    transition={SPRING}
                    className="brand-gradient-mark absolute -left-10 h-5 w-0.5 rounded-full"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </aside>

      {/* The step */}
      <main className="flex min-h-0 flex-col overflow-y-auto">
        <div className="m-auto w-full max-w-xl px-10 py-12">
          {error && <Notice tone="critical" className="mb-6">{error}</Notice>}
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: 24 * d }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: -24 * d }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SPRING}
              className="flex flex-col gap-6"
            >
              {step === "language" && (
                <>
                  <Heading title={t("onboarding.language.title")} desc={t("onboarding.language.desc")} />
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                      <Choice key={l} selected={lang === l} onClick={() => setLang(l)} title={LANG_NAMES[l]} />
                    ))}
                  </div>
                  <Nav onNext={next} />
                </>
              )}

              {step === "welcome" && (
                <>
                  <Heading title={t("onboarding.welcome.title")} desc={t("onboarding.welcome.desc")} />
                  <ToggleRow
                    title={t("onboarding.welcome.stats.toggle")}
                    desc={t("onboarding.welcome.stats.desc")}
                    checked={cfg.reportStats}
                    onChange={(v) => update({ reportStats: v })}
                  />
                  <Nav onBack={back} onNext={next} nextLabel={t("onboarding.welcome.cta")} />
                </>
              )}

              {step === "datadir" && (
                <>
                  <Heading title={t("onboarding.datadir.title")} desc={t("onboarding.datadir.desc")} />
                  <input
                    className="input font-mono text-xs"
                    value={cfg.dataDir}
                    onChange={(e) => update({ dataDir: e.target.value })}
                    spellCheck={false}
                  />
                  <Nav onBack={back} onNext={next} />
                </>
              )}

              {step === "syncmode" && (
                <>
                  <Heading title={t("onboarding.syncmode.title")} />
                  <div className="flex flex-col gap-2">
                    <Choice
                      selected={cfg.syncMode === "snap"}
                      onClick={() => update({ syncMode: "snap" })}
                      title={t("onboarding.syncmode.snap.title")}
                      desc={t("onboarding.syncmode.snap.desc")}
                    />
                    <Choice
                      selected={cfg.syncMode === "full"}
                      onClick={() => update({ syncMode: "full" })}
                      title={t("onboarding.syncmode.full.title")}
                      desc={t("onboarding.syncmode.full.desc")}
                    />
                  </div>
                  <Nav onBack={back} onNext={next} />
                </>
              )}

              {step === "networking" && (
                <>
                  <Heading title={t("onboarding.networking.title")} desc={t("onboarding.networking.desc")} />
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("onboarding.networking.desc2")}</p>
                  <ToggleRow
                    title={t("onboarding.networking.toggle")}
                    desc={t("onboarding.networking.recommended")}
                    checked={!cfg.blockInbound}
                    onChange={(v) => update({ blockInbound: !v })}
                  />
                  <Nav onBack={back} onNext={next} />
                </>
              )}

              {step === "rpc" && (
                <>
                  <Heading
                    eyebrow={t("onboarding.rpc.eyebrow")}
                    title={t("onboarding.rpc.title")}
                    desc={
                      <>
                        {t("onboarding.rpc.desc1")}{" "}
                        <span className="font-mono text-foreground">http://127.0.0.1:{cfg.httpRpcPort}</span>{" "}
                        {t("onboarding.rpc.desc2")}
                      </>
                    }
                  />
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("onboarding.rpc.desc3")}</p>
                  <Nav onBack={back} onNext={finish} nextLabel={t("onboarding.rpc.cta")} />
                </>
              )}

              {step === "starting" && (
                <div className="flex flex-col items-center gap-5 py-16 text-center">
                  <Loader2 className="size-10 animate-spin text-brand" strokeWidth={1.5} />
                  <h2 className="text-3xl">{t("onboarding.starting.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("onboarding.starting.desc")}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function Heading({ eyebrow, title, desc }: { eyebrow?: string; title: string; desc?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {eyebrow && <Label>{eyebrow}</Label>}
      <h2 className="text-4xl leading-tight">{title}</h2>
      {desc && <p className="leading-relaxed text-muted-foreground">{desc}</p>}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel }: { onBack?: () => void; onNext: () => void; nextLabel?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between pt-2">
      {onBack ? (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("common.back")}
        </button>
      ) : (
        <span />
      )}
      <button type="button" className="btn btn-primary" onClick={onNext}>
        {nextLabel ?? t("common.continue")}
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

function Choice({ selected, onClick, title, desc }: { selected: boolean; onClick: () => void; title: string; desc?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group/plate relative flex items-start gap-3 rounded-md border p-4 text-left transition-colors ${
        selected ? "border-brand/60 bg-brand-muted/30" : "border-border bg-surface-elevated hover:border-foreground/20"
      }`}
    >
      <span
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${
          selected ? "brand-gradient border-transparent" : "border-border-strong"
        }`}
      >
        <AnimatePresence>
          {selected && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={SPRING}
              className="size-1.5 rounded-full bg-brand-foreground"
            />
          )}
        </AnimatePresence>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
      </span>
    </button>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-md border border-border bg-surface-elevated px-5 py-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}
