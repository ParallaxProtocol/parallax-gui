import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { api, GUIConfig, UpdateInfo } from "../../lib/api";
import SectionHeading from "../../components/SectionHeading";
import { PageStagger, StaggerItem } from "../../components/PageStagger";
import Toggle from "../../components/Toggle";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";

// Fields that only take effect after a fresh node start. Touching any of
// these flips `restartPending` so we can warn the user in the save bar.
const RESTART_FIELDS: (keyof GUIConfig)[] = [
  "dataDir",
  "syncMode",
  "httpRpcEnabled",
  "httpRpcPort",
  "blockInbound",
  "maxPeers",
  "enableSmartFee",
  "databaseCacheMB",
  "trieCleanCacheMB",
  "trieDirtyCacheMB",
  "snapshotCacheMB",
];

export default function Settings() {
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [orig, setOrig] = useState<GUIConfig | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Sticks around even after Save until the user restarts the node.
  const [restartPending, setRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const [clientVersion, setClientVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const { lang, setLang } = useLang();
  const t = useT();

  useEffect(() => {
    api.getConfig().then((c) => {
      setCfg(c);
      setOrig(c);
    });
    api.version().then(setAppVersion).catch(() => { });
    api.clientVersion().then(setClientVersion).catch(() => { });
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<GUIConfig>) => setCfg({ ...cfg, ...patch });

  const dirty =
    !!orig && JSON.stringify(cfg) !== JSON.stringify(orig);

  // True when the *currently dirty* changes include any restart-only field.
  const dirtyNeedsRestart =
    !!orig && RESTART_FIELDS.some((k) => cfg[k] !== orig[k]);

  const save = async () => {
    setErr(null);
    try {
      await api.updateConfig(cfg);
      if (dirtyNeedsRestart) setRestartPending(true);
      setOrig(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Notify App so globally-applied flags (e.g. animation kill
      // switch) re-read the latest config without a reload.
      window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const discard = () => {
    if (orig) setCfg(orig);
    setErr(null);
  };

  const restartNode = async () => {
    setRestarting(true);
    setErr(null);
    try {
      await api.stopNode();
      await api.startNode();
      setRestartPending(false);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <PageStagger className="space-y-12 max-w-3xl mx-auto">
      <StaggerItem>
        <SectionHeading
          eyebrow={t("settings.eyebrow")}
          title={t("settings.title")}
        />
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.language")}</div>
          <p className="text-sm text-muted leading-relaxed">
            {t("settings.language.desc")}
          </p>
          <Field label={t("settings.language.label")}>
            <select
              className="input"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.node")}</div>

          <Field label={t("settings.dataDir")}>
            <input
              className="input font-mono"
              value={cfg.dataDir}
              onChange={(e) => update({ dataDir: e.target.value })}
            />
          </Field>

          <Field label={t("settings.syncMode")}>
            <select
              className="input"
              value={cfg.syncMode}
              onChange={(e) =>
                update({ syncMode: e.target.value as GUIConfig["syncMode"] })
              }
            >
              <option value="snap">{t("settings.syncMode.snap")}</option>
              <option value="full">{t("settings.syncMode.full")}</option>
            </select>
          </Field>

          <Field label={t("settings.maxPeers")}>
            <input
              type="number"
              className="input"
              value={cfg.maxPeers}
              onChange={(e) =>
                update({ maxPeers: parseInt(e.target.value, 10) || 0 })
              }
            />
          </Field>

          <Field label={t("settings.autoStart")}>
            <Toggle
              checked={cfg.autoStartNode}
              onChange={(v) => update({ autoStartNode: v })}
            />
          </Field>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.appearance")}</div>
          <p className="text-sm text-muted leading-relaxed">
            {t("settings.appearance.desc")}
          </p>
          <Field label={t("settings.disableAnimations")}>
            <Toggle
              checked={cfg.disableAnimations}
              onChange={(v) => update({ disableAnimations: v })}
            />
          </Field>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.networking")}</div>
          <p className="text-sm text-muted leading-relaxed">
            {t("settings.networking.desc")}
          </p>

          <Field label={t("settings.allowInbound")}>
            <Toggle
              checked={!cfg.blockInbound}
              onChange={(v) => update({ blockInbound: !v })}
            />
          </Field>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.rpc.title")}</div>
          <p className="text-sm text-muted leading-relaxed">
            {t("settings.rpc.desc")}
          </p>

          <Field label={t("settings.rpc.enable")}>
            <Toggle
              checked={cfg.httpRpcEnabled}
              onChange={(v) => update({ httpRpcEnabled: v })}
            />
          </Field>
          <AnimatePresence initial={false}>
            {cfg.httpRpcEnabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <Field label={t("settings.rpc.port")}>
                  <input
                    type="number"
                    className="input"
                    value={cfg.httpRpcPort}
                    onChange={(e) =>
                      update({
                        httpRpcPort: parseInt(e.target.value, 10) || 8545,
                      })
                    }
                  />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.fee.title")}</div>
          <p className="text-sm text-muted leading-relaxed">
            {t("settings.fee.desc1a")}{" "}
            <span className="font-mono text-fg/80">estimateSmartFee</span>{" "}
            {t("settings.fee.desc1b")}
          </p>
          <p className="text-sm text-muted leading-relaxed">
            <span className="text-gold">{t("settings.fee.recommended")}</span>{" "}
            {t("settings.fee.desc2")}
          </p>

          <Field label={t("settings.smartFee")}>
            <Toggle
              checked={cfg.enableSmartFee}
              onChange={(v) => update({ enableSmartFee: v })}
            />
          </Field>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card">
          <div className="card-title mb-4">{t("settings.diagnostics")}</div>
          <div className="flex items-center justify-between gap-6">
            <p className="text-sm text-muted leading-relaxed max-w-md">
              {t("settings.diagnostics.desc")}
            </p>
            <Link to="/logs" className="btn-ghost shrink-0">
              {t("settings.showLogs")}
            </Link>
          </div>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-3">
          <button
            className="btn-ghost"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? t("settings.advanced.hide") : t("settings.advanced.show")}
          </button>

          <AnimatePresence initial={false}>
            {advanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-5 pt-4">
                  <Field label={t("settings.dbCache")}>
                    <input
                      type="number"
                      className="input"
                      value={cfg.databaseCacheMB}
                      onChange={(e) =>
                        update({
                          databaseCacheMB: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("settings.trieClean")}>
                    <input
                      type="number"
                      className="input"
                      value={cfg.trieCleanCacheMB}
                      onChange={(e) =>
                        update({
                          trieCleanCacheMB: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("settings.trieDirty")}>
                    <input
                      type="number"
                      className="input"
                      value={cfg.trieDirtyCacheMB}
                      onChange={(e) =>
                        update({
                          trieDirtyCacheMB: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("settings.snapshotCache")}>
                    <input
                      type="number"
                      className="input"
                      value={cfg.snapshotCacheMB}
                      onChange={(e) =>
                        update({
                          snapshotCacheMB: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="card space-y-5">
          <div className="card-title">{t("settings.about")}</div>
          <dl className="grid grid-cols-3 gap-y-3 text-sm">
            <dt className="eyebrow self-center">{t("settings.about.client")}</dt>
            <dd className="col-span-2 font-mono text-fg">
              prlx {clientVersion || "—"}
            </dd>
            <dt className="eyebrow self-center">{t("settings.about.desktop")}</dt>
            <dd className="col-span-2 font-mono text-fg">
              {appVersion || "—"}
            </dd>
          </dl>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="btn-ghost shrink-0"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setCheckResult(null);
                setUpdateInfo(null);
                try {
                  const info = await api.checkForUpdate();
                  if (info) {
                    setUpdateInfo(info);
                    setCheckResult(
                      t("settings.about.updateAvailable", {
                        version: info.latestVersion,
                      }),
                    );
                  } else {
                    setCheckResult(t("settings.about.upToDate"));
                  }
                } catch (e: any) {
                  setCheckResult(e?.message || t("settings.about.checkFailed"));
                }
                setChecking(false);
              }}
            >
              {checking ? t("settings.about.checking") : t("settings.about.check")}
            </button>
            {checkResult && (
              <span className="text-sm text-muted">{checkResult}</span>
            )}
            {updateInfo && (
              <button
                type="button"
                className="btn-ghost shrink-0"
                disabled={updating}
                onClick={async () => {
                  setUpdating(true);
                  try {
                    await api.applyUpdate();
                  } catch (e: any) {
                    setCheckResult(e?.message || t("settings.about.updateFailed"));
                    setUpdating(false);
                  }
                }}
              >
                {updating ? t("settings.about.updating") : t("settings.about.updateNow")}
              </button>
            )}
          </div>
        </section>
      </StaggerItem>

      {err && (
        <StaggerItem>
          <div className="card border-danger/40 bg-danger/10 text-danger">{err}</div>
        </StaggerItem>
      )}

      {/* Spacer so the floating save bar never covers the last setting. */}
      <div className="h-20" />

      <FloatingSaveBar
        dirty={dirty}
        saved={saved}
        dirtyNeedsRestart={dirtyNeedsRestart}
        restartPending={restartPending}
        restarting={restarting}
        onSave={save}
        onDiscard={discard}
        onRestart={restartNode}
      />
    </PageStagger>
  );
}

function FloatingSaveBar({
  dirty,
  saved,
  dirtyNeedsRestart,
  restartPending,
  restarting,
  onSave,
  onDiscard,
  onRestart,
}: {
  dirty: boolean;
  saved: boolean;
  dirtyNeedsRestart: boolean;
  restartPending: boolean;
  restarting: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onRestart: () => void;
}) {
  const t = useT();
  const visible = dirty || saved || restartPending;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="save-bar"
          className="fixed bottom-8 right-8 z-40 flex items-center gap-3 rounded-full border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-2.5 shadow-2xl max-w-[90vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {dirty ? (
            <>
              <div className="flex flex-col pl-1 pr-1 leading-tight">
                <span className="text-xs text-fg">{t("settings.save.unsaved")}</span>
                {dirtyNeedsRestart && (
                  <span className="text-[10px] uppercase tracking-wider text-gold">
                    {t("settings.save.needsRestart")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onDiscard}
                className="text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-2"
              >
                {t("common.discard")}
              </button>
              <button
                type="button"
                onClick={onSave}
                className="btn-primary !py-1.5 !px-4"
              >
                {t("common.save")}
              </button>
            </>
          ) : restartPending ? (
            <>
              <div className="flex items-center gap-2 pl-1 pr-1">
                <span className="live-dot-warn" />
                <span className="text-xs text-fg">
                  {t("settings.save.restartRequired")}
                </span>
              </div>
              <button
                type="button"
                onClick={onRestart}
                disabled={restarting}
                className="btn-primary !py-1.5 !px-4"
              >
                {restarting ? t("settings.save.restarting") : t("settings.save.restart")}
              </button>
            </>
          ) : (
            <span className="text-success text-sm flex items-center gap-2 px-2">
              <span className="live-dot-success" />
              {t("settings.save.saved")}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-center">
      <label className="eyebrow">{label}</label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}
