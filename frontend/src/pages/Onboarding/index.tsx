import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { api, GUIConfig } from "../../lib/api";
import { GLIDE, SPRING } from "../../lib/motion";
import { StepMark } from "../../components/ui/StepMark";
import Toggle from "../../components/ui/Toggle";
import { Row, Rows } from "../../components/ui/Panel";
import { Notice } from "../../components/ui/bits";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import logo from "../../assets/logo.svg";

type Step = "language" | "welcome" | "datadir" | "syncmode" | "networking" | "rpc" | "starting";

const STEPS: Step[] = ["language", "welcome", "datadir", "syncmode", "networking", "rpc"];

/**
 * Onboarding is the first-run setup assistant: the steps in the sidebar,
 * the current step beside them, sliding in the direction of travel, and
 * Back/Continue in the footer.
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

  // Each step's own Back/Continue, pinned to the footer as in a setup assistant
  const nav: Record<Exclude<Step, "starting">, { onBack?: () => void; onNext: () => void; nextLabel?: string }> = {
    language: { onNext: next },
    welcome: { onBack: back, onNext: next, nextLabel: t("onboarding.welcome.cta") },
    datadir: { onBack: back, onNext: next },
    syncmode: { onBack: back, onNext: next },
    networking: { onBack: back, onNext: next },
    rpc: { onBack: back, onNext: finish, nextLabel: t("onboarding.rpc.cta") },
  };

  return (
    <div className="flex h-full">
      {/* The steps, in the window's sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="drag flex h-11 shrink-0 items-center gap-2 px-4">
          <span className="traffic-light-gap" />
          <img src={logo} alt="" className="size-4.5" />
          <span className="font-semibold">Parallax</span>
        </div>
        <ol className="flex flex-col gap-px px-2 pt-2">
          {STEPS.map((s, i) => {
            const done = i < index || step === "starting";
            const here = s === step;
            return (
              <li
                key={s}
                aria-current={here ? "step" : undefined}
                className={`relative flex h-7 items-center gap-2.5 rounded-md px-2 ${here ? "font-medium" : ""}`}
              >
                {here && (
                  <motion.span
                    layoutId="onboarding-selection"
                    layoutDependency={step}
                    transition={GLIDE}
                    className="absolute inset-0 rounded-md bg-selected"
                  />
                )}
                <span className="relative grid size-4 place-items-center">
                  {done ? (
                    <StepMark state="done" size={16} />
                  ) : (
                    <span
                      className={`grid size-4 place-items-center rounded-full border text-[10px] tabular-nums transition-colors ${
                        here ? "border-brand-mark text-brand" : "border-border-strong text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </span>
                  )}
                </span>
                <span className={`relative transition-colors ${here || done ? "" : "text-muted-foreground"}`}>
                  {t(`onboarding.step.${s}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* The step */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag flex h-11 shrink-0 items-center">
          <span className="flex-1" />
          <span className="window-controls-gap" />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-lg px-8 pt-6 pb-8">
            {error && <Notice tone="critical" className="mb-5">{error}</Notice>}
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: 16 * d }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: -16 * d }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={SPRING}
                className="flex flex-col gap-5"
              >
                {step === "language" && (
                  <>
                    <Heading title={t("onboarding.language.title")} desc={t("onboarding.language.desc")} />
                    <div className="flex flex-col gap-2">
                      {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                        <Choice key={l} selected={lang === l} onClick={() => setLang(l)} title={LANG_NAMES[l]} />
                      ))}
                    </div>
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
                  </>
                )}

                {step === "datadir" && (
                  <>
                    <Heading title={t("onboarding.datadir.title")} desc={t("onboarding.datadir.desc")} />
                    <input
                      className="input font-mono text-sm"
                      value={cfg.dataDir}
                      onChange={(e) => update({ dataDir: e.target.value })}
                      spellCheck={false}
                      aria-label={t("settings.dataDir")}
                    />
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
                  </>
                )}

                {step === "networking" && (
                  <>
                    <Heading title={t("onboarding.networking.title")} desc={t("onboarding.networking.desc")} />
                    <p className="text-muted-foreground">{t("onboarding.networking.desc2")}</p>
                    <ToggleRow
                      title={t("onboarding.networking.toggle")}
                      desc={t("onboarding.networking.recommended")}
                      checked={!cfg.blockInbound}
                      onChange={(v) => update({ blockInbound: !v })}
                    />
                  </>
                )}

                {step === "rpc" && (
                  <>
                    <Heading
                      title={t("onboarding.rpc.title")}
                      desc={
                        <>
                          {t("onboarding.rpc.desc1")}{" "}
                          <span className="font-mono text-foreground">http://127.0.0.1:{cfg.httpRpcPort}</span>{" "}
                          {t("onboarding.rpc.desc2")}
                        </>
                      }
                    />
                    <p className="text-muted-foreground">{t("onboarding.rpc.desc3")}</p>
                  </>
                )}

                {step === "starting" && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    <h2 className="text-xl font-semibold">{t("onboarding.starting.title")}</h2>
                    <p className="text-muted-foreground">{t("onboarding.starting.desc")}</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        {step !== "starting" && <Nav {...nav[step]} />}
      </div>
    </div>
  );
}

function Heading({ title, desc }: { title: string; desc?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      {desc && <p className="text-muted-foreground">{desc}</p>}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel }: { onBack?: () => void; onNext: () => void; nextLabel?: string }) {
  const t = useT();
  return (
    <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border px-5">
      {onBack && (
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          {t("common.back")}
        </button>
      )}
      <button type="button" className="btn btn-primary" onClick={onNext}>
        {nextLabel ?? t("common.continue")}
      </button>
    </footer>
  );
}

/** Choice is one option of a radio list. */
function Choice({ selected, onClick, title, desc }: { selected: boolean; onClick: () => void; title: string; desc?: string }) {
  return (
    <button
      type="button"
      role="radio"
      onClick={onClick}
      aria-checked={selected}
      className={`flex items-start gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors ${
        selected ? "border-brand-mark ring-1 ring-brand-mark" : "border-border hover:border-border-strong"
      }`}
    >
      <span
        className={`mt-px grid size-4 shrink-0 place-items-center rounded-full transition-colors ${
          selected ? "bg-brand-fill" : "border border-border-strong bg-field"
        }`}
      >
        <AnimatePresence initial={false}>
          {selected && (
            <motion.span
              className="size-1.5 rounded-full bg-brand-foreground"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={GLIDE}
            />
          )}
        </AnimatePresence>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {desc && <span className="text-sm text-muted-foreground">{desc}</span>}
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
    <Rows>
      <Row title={<span className="font-medium">{title}</span>} desc={desc}>
        <Toggle checked={checked} onChange={onChange} label={title} />
      </Row>
    </Rows>
  );
}
