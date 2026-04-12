import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, GUIConfig } from "../../lib/api";
import Toggle from "../../components/Toggle";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import logo from "../../assets/logo.svg";

type Step =
  | "language"
  | "welcome"
  | "datadir"
  | "syncmode"
  | "networking"
  | "rpc"
  | "starting";

const STEPS: Step[] = [
  "language",
  "welcome",
  "datadir",
  "syncmode",
  "networking",
  "rpc",
  "starting",
];

export default function Onboarding({ onFinished }: { onFinished: () => void }) {
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [step, setStep] = useState<Step>("language");
  const [error, setError] = useState<string | null>(null);
  const { lang, setLang } = useLang();
  const t = useT();

  useEffect(() => {
    api.getConfig().then(setCfg);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<GUIConfig>) => setCfg({ ...cfg, ...patch });

  const finish = async () => {
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

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="h-full grid place-items-center p-8 relative overflow-hidden">
      {/* Soft ambient circle behind the wizard */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgb(247 147 26 / 0.10), transparent 60%)",
          }}
        />
      </div>

      <div className="w-full max-w-2xl relative">
        <motion.div
          className="flex flex-col items-center gap-4 mb-12"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.img
            src={logo}
            className="h-16 w-16"
            alt="Parallax"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            className="block h-[2px] w-10 bg-gold rounded-full"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
          <div className="eyebrow">{t("onboarding.welcome")}</div>
          <h1 className="display text-center">{t("onboarding.brand")}</h1>
        </motion.div>

        {/* Step indicator dots */}
        {step !== "starting" && (
          <div className="flex justify-center gap-2 mb-6">
            {STEPS.slice(0, -1).map((s, i) => (
              <motion.span
                key={s}
                className="h-1 rounded-full"
                animate={{
                  width: i === stepIndex ? 24 : 8,
                  backgroundColor:
                    i <= stepIndex
                      ? "rgb(247 147 26)"
                      : "oklch(1 0 0 / 0.15)",
                }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
          </div>
        )}

        {error && (
          <motion.div
            className="card border-danger/40 bg-danger/10 text-danger mb-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === "language" && (
              <div className="card space-y-5">
                <h2 className="display-sm">{t("onboarding.language.title")}</h2>
                <p className="text-muted leading-relaxed">
                  {t("onboarding.language.desc")}
                </p>
                <div className="space-y-3">
                  {(Object.keys(LANG_NAMES) as Lang[]).map((l) => {
                    const selected = lang === l;
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLang(l)}
                        className={`text-left rounded border p-4 w-full transition-all duration-300 ${
                          selected
                            ? "border-gold bg-gold-muted shadow-gold-glow"
                            : "border-border hover:bg-bg-elev hover:border-fg/20"
                        }`}
                      >
                        <div className="font-medium">{LANG_NAMES[l]}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <button
                    className="btn-primary"
                    onClick={() => setStep("welcome")}
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {step === "welcome" && (
              <div className="card space-y-5">
                <h2 className="display-sm">{t("onboarding.welcome.title")}</h2>
                <p className="text-muted leading-relaxed">
                  {t("onboarding.welcome.desc")}
                </p>
                <div className="flex justify-between">
                  <button
                    className="btn-ghost"
                    onClick={() => setStep("language")}
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setStep("datadir")}
                  >
                    {t("onboarding.welcome.cta")}
                  </button>
                </div>
              </div>
            )}

            {step === "datadir" && (
              <div className="card space-y-5">
                <h2 className="display-sm">{t("onboarding.datadir.title")}</h2>
                <p className="text-muted text-sm leading-relaxed">
                  {t("onboarding.datadir.desc")}
                </p>
                <input
                  className="input font-mono"
                  value={cfg.dataDir}
                  onChange={(e) => update({ dataDir: e.target.value })}
                />
                <div className="flex justify-between">
                  <button
                    className="btn-ghost"
                    onClick={() => setStep("welcome")}
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setStep("syncmode")}
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {step === "syncmode" && (
              <div className="card space-y-5">
                <h2 className="display-sm">{t("onboarding.syncmode.title")}</h2>
                <SyncOption
                  k="snap"
                  title={t("onboarding.syncmode.snap.title")}
                  desc={t("onboarding.syncmode.snap.desc")}
                  cfg={cfg}
                  update={update}
                />
                <SyncOption
                  k="full"
                  title={t("onboarding.syncmode.full.title")}
                  desc={t("onboarding.syncmode.full.desc")}
                  cfg={cfg}
                  update={update}
                />
                <div className="flex justify-between pt-2">
                  <button
                    className="btn-ghost"
                    onClick={() => setStep("datadir")}
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setStep("networking")}
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {step === "networking" && (
              <div className="card space-y-5">
                <h2 className="display-sm">{t("onboarding.networking.title")}</h2>
                <p className="text-muted leading-relaxed">
                  {t("onboarding.networking.desc")}
                </p>
                <p className="text-muted text-sm leading-relaxed">
                  {t("onboarding.networking.desc2")}
                </p>

                <div className="flex items-center justify-between rounded border border-border bg-bg-elev-2 px-4 py-3">
                  <div>
                    <div className="text-sm text-fg">
                      {t("onboarding.networking.toggle")}
                    </div>
                    <div className="text-xs text-muted">
                      {t("onboarding.networking.recommended")}
                    </div>
                  </div>
                  <Toggle
                    checked={!cfg.blockInbound}
                    onChange={(v) => update({ blockInbound: !v })}
                  />
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    className="btn-ghost"
                    onClick={() => setStep("syncmode")}
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setStep("rpc")}
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {step === "rpc" && (
              <div className="card space-y-5">
                <div className="eyebrow">{t("onboarding.rpc.eyebrow")}</div>
                <h2 className="display-sm">{t("onboarding.rpc.title")}</h2>
                <p className="text-muted leading-relaxed">
                  {t("onboarding.rpc.desc1")}{" "}
                  <span className="font-mono text-fg">
                    http://127.0.0.1:{cfg.httpRpcPort}
                  </span>{" "}
                  {t("onboarding.rpc.desc2")}
                </p>
                <p className="text-muted text-sm leading-relaxed">
                  {t("onboarding.rpc.desc3")}
                </p>
                <div className="flex justify-between pt-2">
                  <button
                    className="btn-ghost"
                    onClick={() => setStep("networking")}
                  >
                    {t("common.back")}
                  </button>
                  <button className="btn-primary" onClick={finish}>
                    {t("onboarding.rpc.cta")}
                  </button>
                </div>
              </div>
            )}

            {step === "starting" && (
              <div className="card text-center py-16">
                <motion.div
                  className="mx-auto h-12 w-12 rounded-full border-2 border-border-strong border-t-gold mb-6"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                />
                <div className="display-sm">{t("onboarding.starting.title")}</div>
                <p className="text-muted text-sm mt-3">
                  {t("onboarding.starting.desc")}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SyncOption({
  k,
  title,
  desc,
  cfg,
  update,
}: {
  k: GUIConfig["syncMode"];
  title: string;
  desc: string;
  cfg: GUIConfig;
  update: (p: Partial<GUIConfig>) => void;
}) {
  const selected = cfg.syncMode === k;
  return (
    <button
      type="button"
      onClick={() => update({ syncMode: k })}
      className={`text-left rounded border p-4 w-full transition-all duration-300 ${
        selected
          ? "border-gold bg-gold-muted shadow-gold-glow"
          : "border-border hover:bg-bg-elev hover:border-fg/20"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-sm text-muted">{desc}</div>
    </button>
  );
}
