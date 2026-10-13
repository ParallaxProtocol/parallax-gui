import { useEffect, useState, type ReactNode } from "react";
import { Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { api, GUIConfig, UpdateInfo } from "../../lib/api";
import { applyTheme } from "../../lib/theme";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Row, Rows } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import Toggle from "../../components/ui/Toggle";
import { Notice } from "../../components/ui/bits";
import LogsPanel from "./LogsPanel";

// Fields that only take effect after a fresh node start. Touching any of
// these flags the save bar's restart warning.
const RESTART_FIELDS: (keyof GUIConfig)[] = [
  "dataDir",
  "syncMode",
  "httpRpcEnabled",
  "httpRpcPort",
  "blockInbound",
  "maxPeers",
  "enableSmartFee",
  "reportStats",
  "databaseCacheMB",
  "trieCleanCacheMB",
  "trieDirtyCacheMB",
  "snapshotCacheMB",
];

const SECTIONS = ["general", "appearance", "node", "network", "performance", "diagnostics", "about"] as const;
type Section = (typeof SECTIONS)[number];

export default function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [orig, setOrig] = useState<GUIConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Sticks around after Save until the node restarts
  const [restartPending, setRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [section, setSection] = useState<Section>("general");

  useEffect(() => {
    api.getConfig().then((c) => {
      setCfg(c);
      setOrig(c);
    });
  }, []);

  if (!cfg || !orig) return null;

  const update = (patch: Partial<GUIConfig>) => setCfg({ ...cfg, ...patch });

  // Appearance applies and saves at once, outside the save bar: a theme is
  // judged by seeing it
  const instant = async (patch: Partial<GUIConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    setOrig((o) => (o ? { ...o, ...patch } : o));
    if (patch.theme) applyTheme(patch.theme);
    try {
      const fresh = await api.getConfig();
      await api.updateConfig({ ...fresh, ...patch });
      window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const dirty = JSON.stringify(cfg) !== JSON.stringify(orig);
  const dirtyNeedsRestart = RESTART_FIELDS.some((k) => cfg[k] !== orig[k]);

  const save = async () => {
    setErr(null);
    try {
      await api.updateConfig(cfg);
      if (dirtyNeedsRestart) setRestartPending(true);
      setOrig(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
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

  const num = (v: string, fallback: number) => parseInt(v, 10) || fallback;

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label={t("nav.settings")} className="flex w-44 shrink-0 flex-col gap-px border-r border-border p-2">
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            aria-current={section === id ? "page" : undefined}
            className={`flex h-7 items-center rounded-md px-2 text-left ${
              section === id ? "bg-selected font-medium" : "text-foreground/80 hover:bg-hover"
            }`}
          >
            {t(`settings.section.${id}`)}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 ${section === "diagnostics" ? "flex flex-col" : "overflow-y-auto"}`}>
          <div className={`flex flex-col gap-4 p-5 ${section === "diagnostics" ? "min-h-0 flex-1" : "max-w-3xl"}`}>
            {err && <Notice tone="critical">{err}</Notice>}

            {section === "general" && (
              <Rows>
                <Setting title={t("settings.language.label")} desc={t("settings.language.desc")}>
                  <select className="input w-52" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                    {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                      <option key={l} value={l}>
                        {LANG_NAMES[l]}
                      </option>
                    ))}
                  </select>
                </Setting>
                <Setting title={t("settings.autoStart")} desc={t("settings.autoStart.desc")}>
                  <Toggle checked={cfg.autoStartNode} onChange={(v) => update({ autoStartNode: v })} label={t("settings.autoStart")} />
                </Setting>
              </Rows>
            )}

            {section === "appearance" && (
              <Rows>
                <Setting title={t("settings.theme")} desc={t("settings.theme.desc")}>
                  <Segmented
                    value={cfg.theme || "system"}
                    onChange={(v) => instant({ theme: v })}
                    options={[
                      { value: "system", label: t("settings.theme.system") },
                      { value: "light", label: t("settings.theme.light") },
                      { value: "dark", label: t("settings.theme.dark") },
                    ]}
                  />
                </Setting>
                <Setting title={t("settings.disableAnimations")} desc={t("settings.appearance.desc")}>
                  <Toggle
                    checked={cfg.disableAnimations}
                    onChange={(v) => instant({ disableAnimations: v })}
                    label={t("settings.disableAnimations")}
                  />
                </Setting>
              </Rows>
            )}

            {section === "node" && (
              <Rows>
                <Setting title={t("settings.dataDir")} desc={t("settings.dataDir.desc")} restart={cfg.dataDir !== orig.dataDir}>
                  <input className="input w-72 font-mono text-sm" value={cfg.dataDir} onChange={(e) => update({ dataDir: e.target.value })} />
                </Setting>
                <Setting title={t("settings.syncMode")} desc={t("settings.syncMode.desc")} restart={cfg.syncMode !== orig.syncMode}>
                  <Segmented
                    value={cfg.syncMode}
                    onChange={(v) => update({ syncMode: v })}
                    options={[
                      { value: "snap", label: t("settings.syncMode.snap") },
                      { value: "full", label: t("settings.syncMode.full") },
                    ]}
                  />
                </Setting>
                <Setting title={t("settings.maxPeers")} desc={t("settings.maxPeers.desc")} restart={cfg.maxPeers !== orig.maxPeers}>
                  <input
                    type="number"
                    className="input w-24 text-right tabular-nums"
                    value={cfg.maxPeers}
                    onChange={(e) => update({ maxPeers: num(e.target.value, 0) })}
                  />
                </Setting>
              </Rows>
            )}

            {section === "network" && (
              <Rows>
                <Setting
                  title={t("settings.allowInbound")}
                  desc={t("settings.networking.desc")}
                  restart={cfg.blockInbound !== orig.blockInbound}
                >
                  <Toggle checked={!cfg.blockInbound} onChange={(v) => update({ blockInbound: !v })} label={t("settings.allowInbound")} />
                </Setting>
                <Setting title={t("settings.rpc.enable")} desc={t("settings.rpc.desc")} restart={cfg.httpRpcEnabled !== orig.httpRpcEnabled}>
                  <Toggle checked={cfg.httpRpcEnabled} onChange={(v) => update({ httpRpcEnabled: v })} label={t("settings.rpc.enable")} />
                </Setting>
                {cfg.httpRpcEnabled && (
                  <Setting title={t("settings.rpc.port")} desc={t("settings.rpc.port.desc")} restart={cfg.httpRpcPort !== orig.httpRpcPort}>
                    <input
                      type="number"
                      className="input w-24 text-right tabular-nums"
                      value={cfg.httpRpcPort}
                      onChange={(e) => update({ httpRpcPort: num(e.target.value, 8545) })}
                    />
                  </Setting>
                )}
                <Setting
                  title={t("settings.stats.toggle")}
                  desc={
                    <>
                      {t("settings.stats.desc1")} <span className="font-mono">status.parallaxprotocol.org</span>{" "}
                      {t("settings.stats.desc2")} {t("settings.stats.desc3")}
                    </>
                  }
                  restart={cfg.reportStats !== orig.reportStats}
                >
                  <Toggle checked={cfg.reportStats} onChange={(v) => update({ reportStats: v })} label={t("settings.stats.toggle")} />
                </Setting>
                <Setting
                  title={t("settings.smartFee")}
                  desc={
                    <>
                      {t("settings.fee.desc1a")} <span className="font-mono">estimateSmartFee</span> {t("settings.fee.desc1b")}{" "}
                      <span className="text-warn-ink">{t("settings.fee.recommended")}</span> {t("settings.fee.desc2")}
                    </>
                  }
                  restart={cfg.enableSmartFee !== orig.enableSmartFee}
                >
                  <Toggle checked={cfg.enableSmartFee} onChange={(v) => update({ enableSmartFee: v })} label={t("settings.smartFee")} />
                </Setting>
              </Rows>
            )}

            {section === "performance" && (
              <>
                <p className="px-1 text-sm text-muted-foreground">{t("settings.performance.desc")}</p>
                <Rows>
                  {(
                    [
                      ["databaseCacheMB", "settings.dbCache"],
                      ["trieCleanCacheMB", "settings.trieClean"],
                      ["trieDirtyCacheMB", "settings.trieDirty"],
                      ["snapshotCacheMB", "settings.snapshotCache"],
                    ] as const
                  ).map(([key, label]) => (
                    <Setting key={key} title={t(label)} restart={cfg[key] !== orig[key]}>
                      <input
                        type="number"
                        className="input w-24 text-right tabular-nums"
                        value={cfg[key]}
                        onChange={(e) => update({ [key]: num(e.target.value, 0) })}
                      />
                      <span className="w-6 text-sm text-muted-foreground">MB</span>
                    </Setting>
                  ))}
                </Rows>
              </>
            )}

            {section === "diagnostics" && (
              <>
                <p className="px-1 text-sm text-muted-foreground">{t("settings.diagnostics.desc")}</p>
                <LogsPanel />
              </>
            )}

            {section === "about" && <About />}
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          saved={saved}
          dirtyNeedsRestart={dirtyNeedsRestart}
          restartPending={restartPending}
          restarting={restarting}
          onSave={save}
          onDiscard={() => {
            setCfg(orig);
            setErr(null);
          }}
          onRestart={restartNode}
        />
      </div>
    </div>
  );
}

/** Setting is one row of a settings group, marked while a change to it waits on a node restart. */
function Setting({ title, desc, restart, children }: { title: string; desc?: ReactNode; restart?: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <Row
      title={title}
      desc={desc}
      badge={
        restart && (
          <span className="badge bg-warn/15 text-warn-ink">
            <RotateCcw className="size-2.5" />
            {t("settings.restartBadge")}
          </span>
        )
      }
    >
      {children}
    </Row>
  );
}

function About() {
  const t = useT();
  const [appVersion, setAppVersion] = useState("");
  const [clientVersion, setClientVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    api.version().then(setAppVersion).catch(() => {});
    api.clientVersion().then(setClientVersion).catch(() => {});
  }, []);

  const check = async () => {
    setChecking(true);
    setResult(null);
    setInfo(null);
    try {
      const i = await api.checkForUpdate();
      if (i) {
        setInfo(i);
        setResult(t("settings.about.updateAvailable", { version: i.latestVersion }));
      } else {
        setResult(t("settings.about.upToDate"));
      }
    } catch (e: any) {
      setResult(e?.message || t("settings.about.checkFailed"));
    }
    setChecking(false);
  };

  return (
    <Rows>
      <Row title={t("settings.about.desktop")}>
        <span className="selectable font-mono text-sm">{appVersion || "—"}</span>
      </Row>
      <Row title={t("settings.about.client")}>
        <span className="selectable font-mono text-sm">prlx {clientVersion || "—"}</span>
      </Row>
      <Row title={t("settings.about.updates")} desc={result ?? undefined}>
        {info ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={updating}
            onClick={async () => {
              setUpdating(true);
              try {
                await api.applyUpdate();
              } catch (e: any) {
                setResult(e?.message || t("settings.about.updateFailed"));
                setUpdating(false);
              }
            }}
          >
            {updating && <Loader2 className="size-3.5 animate-spin" />}
            {updating ? t("settings.about.updating") : t("settings.about.updateNow")}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={checking} onClick={check}>
            <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("settings.about.checking") : t("settings.about.check")}
          </button>
        )}
      </Row>
    </Rows>
  );
}

function SaveBar({
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
  if (!dirty && !saved && !restartPending) return null;
  // A footer along the pane, as a preferences window's Apply/Revert row
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border bg-background px-5">
      {dirty ? (
        <>
          <span className="flex-1">
            {t("settings.save.unsaved")}
            {dirtyNeedsRestart && <span className="ml-2 text-sm text-warn-ink">{t("settings.save.needsRestart")}</span>}
          </span>
          <button type="button" onClick={onDiscard} className="btn btn-secondary">
            {t("common.discard")}
          </button>
          <button type="button" onClick={onSave} className="btn btn-primary">
            {t("common.save")}
          </button>
        </>
      ) : restartPending ? (
        <>
          <span className="flex flex-1 items-center gap-2">
            <Indicator grade="warn" />
            {t("settings.save.restartRequired")}
          </span>
          <button type="button" onClick={onRestart} disabled={restarting} className="btn btn-primary">
            {restarting && <Loader2 className="size-3.5 animate-spin" />}
            {restarting ? t("settings.save.restarting") : t("settings.save.restart")}
          </button>
        </>
      ) : (
        <span className="flex items-center gap-2 text-good-ink">
          <Check className="size-3.5" />
          {t("settings.save.saved")}
        </span>
      )}
    </div>
  );
}
