import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { api, GUIConfig, UpdateInfo } from "../../lib/api";
import { applyTheme } from "../../lib/theme";
import { SPRING } from "../../lib/motion";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Label, Plate } from "../../components/ui/Plate";
import { SectionHeader } from "../../components/ui/SectionHeader";
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
    <div className="grid grid-cols-[180px_1fr] gap-10">
      <SectionNav />

      <div className="flex min-w-0 flex-col gap-12 pb-24">
        {err && <Notice tone="critical">{err}</Notice>}

        <Group id="general" index={1}>
          <Row title={t("settings.language.label")} desc={t("settings.language.desc")}>
            <select className="input w-56" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </Row>
          <Row title={t("settings.autoStart")} desc={t("settings.autoStart.desc")}>
            <Toggle checked={cfg.autoStartNode} onChange={(v) => update({ autoStartNode: v })} label={t("settings.autoStart")} />
          </Row>
        </Group>

        <Group id="appearance" index={2}>
          <Row title={t("settings.theme")} desc={t("settings.theme.desc")}>
            <Segmented
              value={cfg.theme || "system"}
              onChange={(v) => instant({ theme: v })}
              options={[
                { value: "system", label: t("settings.theme.system") },
                { value: "light", label: t("settings.theme.light") },
                { value: "dark", label: t("settings.theme.dark") },
              ]}
            />
          </Row>
          <Row title={t("settings.disableAnimations")} desc={t("settings.appearance.desc")}>
            <Toggle
              checked={cfg.disableAnimations}
              onChange={(v) => instant({ disableAnimations: v })}
              label={t("settings.disableAnimations")}
            />
          </Row>
        </Group>

        <Group id="node" index={3}>
          <Row title={t("settings.dataDir")} desc={t("settings.dataDir.desc")} restart={cfg.dataDir !== orig.dataDir}>
            <input className="input w-80 font-mono text-xs" value={cfg.dataDir} onChange={(e) => update({ dataDir: e.target.value })} />
          </Row>
          <Row title={t("settings.syncMode")} desc={t("settings.syncMode.desc")} restart={cfg.syncMode !== orig.syncMode}>
            <Segmented
              value={cfg.syncMode}
              onChange={(v) => update({ syncMode: v })}
              options={[
                { value: "snap", label: t("settings.syncMode.snap") },
                { value: "full", label: t("settings.syncMode.full") },
              ]}
            />
          </Row>
          <Row title={t("settings.maxPeers")} desc={t("settings.maxPeers.desc")} restart={cfg.maxPeers !== orig.maxPeers}>
            <input
              type="number"
              className="input w-28"
              value={cfg.maxPeers}
              onChange={(e) => update({ maxPeers: num(e.target.value, 0) })}
            />
          </Row>
        </Group>

        <Group id="network" index={4}>
          <Row
            title={t("settings.allowInbound")}
            desc={t("settings.networking.desc")}
            restart={cfg.blockInbound !== orig.blockInbound}
          >
            <Toggle checked={!cfg.blockInbound} onChange={(v) => update({ blockInbound: !v })} label={t("settings.allowInbound")} />
          </Row>
          <Row title={t("settings.rpc.enable")} desc={t("settings.rpc.desc")} restart={cfg.httpRpcEnabled !== orig.httpRpcEnabled}>
            <Toggle checked={cfg.httpRpcEnabled} onChange={(v) => update({ httpRpcEnabled: v })} label={t("settings.rpc.enable")} />
          </Row>
          <AnimatePresence initial={false}>
            {cfg.httpRpcEnabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SPRING}
                className="overflow-hidden"
              >
                <Row title={t("settings.rpc.port")} desc={t("settings.rpc.port.desc")} restart={cfg.httpRpcPort !== orig.httpRpcPort}>
                  <input
                    type="number"
                    className="input w-28 font-mono"
                    value={cfg.httpRpcPort}
                    onChange={(e) => update({ httpRpcPort: num(e.target.value, 8545) })}
                  />
                </Row>
              </motion.div>
            )}
          </AnimatePresence>
          <Row
            title={t("settings.stats.toggle")}
            desc={
              <>
                {t("settings.stats.desc1")} <span className="font-mono text-foreground/80">status.parallaxprotocol.org</span>{" "}
                {t("settings.stats.desc2")} {t("settings.stats.desc3")}
              </>
            }
            restart={cfg.reportStats !== orig.reportStats}
          >
            <Toggle checked={cfg.reportStats} onChange={(v) => update({ reportStats: v })} label={t("settings.stats.toggle")} />
          </Row>
          <Row
            title={t("settings.smartFee")}
            desc={
              <>
                {t("settings.fee.desc1a")} <span className="font-mono text-foreground/80">estimateSmartFee</span>{" "}
                {t("settings.fee.desc1b")} <span className="text-warn-ink">{t("settings.fee.recommended")}</span>{" "}
                {t("settings.fee.desc2")}
              </>
            }
            restart={cfg.enableSmartFee !== orig.enableSmartFee}
          >
            <Toggle checked={cfg.enableSmartFee} onChange={(v) => update({ enableSmartFee: v })} label={t("settings.smartFee")} />
          </Row>
        </Group>

        <Group id="performance" index={5}>
          <p className="-mt-1 mb-1 text-sm text-muted-foreground">{t("settings.performance.desc")}</p>
          {(
            [
              ["databaseCacheMB", "settings.dbCache"],
              ["trieCleanCacheMB", "settings.trieClean"],
              ["trieDirtyCacheMB", "settings.trieDirty"],
              ["snapshotCacheMB", "settings.snapshotCache"],
            ] as const
          ).map(([key, label]) => (
            <Row key={key} title={t(label)} restart={cfg[key] !== orig[key]}>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input w-28 font-mono"
                  value={cfg[key]}
                  onChange={(e) => update({ [key]: num(e.target.value, 0) })}
                />
                <span className="font-mono text-xs text-muted-foreground">MB</span>
              </div>
            </Row>
          ))}
        </Group>

        <Group id="diagnostics" index={6}>
          <p className="-mt-1 mb-2 text-sm text-muted-foreground">{t("settings.diagnostics.desc")}</p>
          <LogsPanel />
        </Group>

        <Group id="about" index={7}>
          <About />
        </Group>
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
  );
}

/**
 * SectionNav lists the page's groups and marks the one being read, its
 * mark springing from link to link as the page scrolls.
 */
function SectionNav() {
  const t = useT();
  const [current, setCurrent] = useState<Section>("general");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = ref.current?.closest("main");
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 140;
        const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        let here: Section = SECTIONS[0];
        for (const id of SECTIONS) {
          const el = document.getElementById(`settings-${id}`);
          if (el && (atEnd ? el.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom : el.getBoundingClientRect().top <= top)) {
            here = id;
          }
        }
        setCurrent(here);
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <nav ref={ref} aria-label={t("nav.settings")} className="sticky top-0 self-start pt-1">
      <ol className="flex flex-col gap-0.5">
        {SECTIONS.map((id, i) => {
          const here = current === id;
          return (
            <li key={id} className="relative">
              {here && (
                <motion.span layoutId="settings-current" transition={SPRING} className="absolute inset-0 rounded-sm bg-foreground/[0.06]">
                  <span className="brand-gradient-mark absolute inset-y-1.5 left-0 w-0.5 rounded-full" />
                </motion.span>
              )}
              <button
                type="button"
                onClick={() =>
                  document.getElementById(`settings-${id}`)?.scrollIntoView({
                    behavior: document.body.classList.contains("no-anim") ? "auto" : "smooth",
                    block: "start",
                  })
                }
                className={`relative flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm transition-colors ${
                  here ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`font-mono text-[10px] tabular-nums ${here ? "text-brand" : "text-muted-foreground/60"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {t(`settings.section.${id}`)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Group({ id, index, children }: { id: Section; index: number; children: ReactNode }) {
  const t = useT();
  return (
    <section id={`settings-${id}`} className="flex scroll-mt-6 flex-col gap-4">
      <SectionHeader index={index} title={t(`settings.section.${id}`)} />
      <Plate className="flex flex-col divide-y divide-border px-6 py-1">{children}</Plate>
    </section>
  );
}

/** Row is one setting: what it is and does on the left, its control on the right. */
function Row({ title, desc, restart, children }: { title: string; desc?: ReactNode; restart?: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-10 py-4">
      <div className="min-w-0 max-w-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          <AnimatePresence>
            {restart && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={SPRING}
                className="flex items-center gap-1 rounded-sm bg-warn/15 px-1.5 py-px font-mono text-[9px] tracking-wider text-warn-ink uppercase"
              >
                <RotateCcw className="size-2.5" />
                {t("settings.restartBadge")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {desc && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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
    <div className="flex items-center justify-between gap-8 py-5">
      <dl className="flex gap-10">
        <div>
          <dt>
            <Label className="text-[10px]">{t("settings.about.desktop")}</Label>
          </dt>
          <dd className="mt-1 font-mono text-sm">{appVersion || "—"}</dd>
        </div>
        <div>
          <dt>
            <Label className="text-[10px]">{t("settings.about.client")}</Label>
          </dt>
          <dd className="mt-1 font-mono text-sm">prlx {clientVersion || "—"}</dd>
        </div>
      </dl>
      <div className="flex items-center gap-3">
        <AnimatePresence mode="popLayout">
          {result && (
            <motion.span
              key={result}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={SPRING}
              className="text-sm text-muted-foreground"
            >
              {result}
            </motion.span>
          )}
        </AnimatePresence>
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
            {updating && <Loader2 className="size-4 animate-spin" />}
            {updating ? t("settings.about.updating") : t("settings.about.updateNow")}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={checking} onClick={check}>
            <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("settings.about.checking") : t("settings.about.check")}
          </button>
        )}
      </div>
    </div>
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
  const visible = dirty || saved || restartPending;
  return (
    <AnimatePresence>
      {visible && (
        // Centred over the content column, clear of the sidebar (w-60)
        <motion.div
          key="save-bar"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center pl-60"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={SPRING}
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border-strong bg-surface-elevated py-2 pr-2 pl-5 shadow-2xl">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={dirty ? "dirty" : restartPending ? "restart" : "saved"}
              className="flex items-center gap-3"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={SPRING}
            >
              {dirty ? (
                <>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm">{t("settings.save.unsaved")}</span>
                    {dirtyNeedsRestart && (
                      <span className="font-mono text-[10px] tracking-wider text-warn-ink uppercase">
                        {t("settings.save.needsRestart")}
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={onDiscard} className="btn btn-ghost btn-sm">
                    {t("common.discard")}
                  </button>
                  <button type="button" onClick={onSave} className="btn btn-primary btn-sm rounded-full">
                    {t("common.save")}
                  </button>
                </>
              ) : restartPending ? (
                <>
                  <span className="flex items-center gap-2 text-sm">
                    <Indicator grade="warn" ping />
                    {t("settings.save.restartRequired")}
                  </span>
                  <button type="button" onClick={onRestart} disabled={restarting} className="btn btn-primary btn-sm rounded-full">
                    {restarting && <Loader2 className="size-3.5 animate-spin" />}
                    {restarting ? t("settings.save.restarting") : t("settings.save.restart")}
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-2 py-1.5 pr-3 text-sm text-good-ink">
                  <Indicator grade="good" />
                  {t("settings.save.saved")}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
