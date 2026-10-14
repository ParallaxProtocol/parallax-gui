import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { api, GUIConfig, UpdateInfo } from "../../lib/api";
import { applyTheme } from "../../lib/theme";
import { FADE_IN, FADE_OUT, GLIDE, PAGE, SPRING } from "../../lib/motion";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { useLang, useT, LANG_NAMES, Lang } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Row, Rows } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import Toggle from "../../components/ui/Toggle";
import { Notice } from "../../components/ui/bits";
import LogsPanel from "./LogsPanel";
import { Advanced, countSet, Group, ListInput, NumberInput, Setting, TextInput } from "./fields";

// Fields the app applies itself, at once or on its next action: changing
// them needs no node restart. Every other field configures the node.
const LIVE_FIELDS = new Set<keyof GUIConfig>([
  "bootstrapped",
  "theme",
  "disableAnimations",
  "autoStartNode",
  "logLevel",
  "noUpdateCheck",
  "preventSleep",
  "notifications",
  "resumeMining",
  "miningWallet",
  "miningWorker",
  "miningPool",
  "miningThreads",
  "miningDevices",
  "customPools",
  "watchAddress",
  "staticPeers",
  "trustedPeers",
  "lastMiningMode",
]);

// Fields the daemon reads only as its process starts, from its argv:
// they wait on a restart of the whole app
const APP_FIELDS = new Set<keyof GUIConfig>(["metrics", "metricsExpensive", "metricsAddr", "metricsPort"]);

const SECTIONS = ["general", "appearance", "node", "network", "rpc", "mining", "diagnostics", "about"] as const;
type Section = (typeof SECTIONS)[number];

const LOOPBACK = new Set(["", "127.0.0.1", "localhost", "::1"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [orig, setOrig] = useState<GUIConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Stick around after Save until the node (or the app) restarts
  const [restartPending, setRestartPending] = useState(false);
  const [appRestartPending, setAppRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [section, setSection] = useState<Section>("general");
  const [login, setLogin] = useState<{ supported: boolean; enabled: boolean }>({ supported: false, enabled: false });

  useEffect(() => {
    api.getConfig().then((c) => {
      setCfg(c);
      setOrig(c);
    });
    window.parallax
      ?.loginItem?.()
      .then(setLogin)
      .catch(() => {});
  }, []);

  if (!cfg || !orig) return null;

  const update = (patch: Partial<GUIConfig>) => setCfg({ ...cfg, ...patch });

  // A few settings apply and save at once, outside the save bar: a theme is
  // judged by seeing it, a log level by the logs it lets through
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

  const keys = Object.keys(cfg) as (keyof GUIConfig)[];
  const changed = (k: keyof GUIConfig) => !same(cfg[k], orig[k]);
  /** The restart a pending change to any of `ks` waits on, for its row's badge. */
  const restart = (...ks: (keyof GUIConfig)[]): boolean | "app" => {
    const ch = ks.filter((k) => changed(k) && !LIVE_FIELDS.has(k));
    if (ch.some((k) => APP_FIELDS.has(k))) return "app";
    return ch.length > 0;
  };
  const dirty = keys.some(changed);
  const dirtyNeedsRestart = keys.some((k) => changed(k) && !LIVE_FIELDS.has(k) && !APP_FIELDS.has(k));
  const dirtyNeedsAppRestart = keys.some((k) => changed(k) && APP_FIELDS.has(k));

  const save = async () => {
    setErr(null);
    try {
      await api.updateConfig(cfg);
      if (dirtyNeedsRestart) setRestartPending(true);
      if (dirtyNeedsAppRestart) setAppRestartPending(true);
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

  const restartApp = async () => {
    setRestarting(true);
    try {
      await api.restartApp();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setRestarting(false);
    }
  };

  const toggleLogin = async (on: boolean) => {
    setLogin((l) => ({ ...l, enabled: on }));
    try {
      await window.parallax?.setLoginItem(on);
    } catch (e: any) {
      setLogin((l) => ({ ...l, enabled: !on }));
      setErr(e?.message || String(e));
    }
  };

  const inbound = !cfg.blockInbound;

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label={t("nav.settings")}
        className="flex w-44 shrink-0 flex-col gap-px overflow-y-auto border-r border-border p-2"
      >
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            aria-current={section === id ? "page" : undefined}
            className={`relative flex h-7 shrink-0 items-center rounded-md px-2 text-left transition-colors ${
              section === id ? "font-medium" : "text-foreground/80 hover:bg-hover"
            }`}
          >
            {section === id && (
              <motion.span
                layoutId="settings-selection"
                layoutDependency={section}
                transition={GLIDE}
                className="absolute inset-0 rounded-md bg-selected"
              />
            )}
            <span className="relative">{t(`settings.section.${id}`)}</span>
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section}
            {...PAGE}
            className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] ${section === "diagnostics" ? "flex flex-col" : ""}`}
          >
            <div className={`flex flex-col gap-6 p-5 ${section === "diagnostics" ? "flex-1" : "max-w-3xl"}`}>
              {err && <Notice tone="critical">{err}</Notice>}

              {section === "general" && (
                <>
                  <Group title={t("settings.group.language")}>
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
                    </Rows>
                  </Group>
                  <Group title={t("settings.group.startup")}>
                    <Rows>
                      {login.supported && (
                        <Setting title={t("settings.openAtLogin")} desc={t("settings.openAtLogin.desc")}>
                          <Toggle checked={login.enabled} onChange={toggleLogin} label={t("settings.openAtLogin")} />
                        </Setting>
                      )}
                      <Setting title={t("settings.autoStart")} desc={t("settings.autoStart.desc")}>
                        <Toggle
                          checked={cfg.autoStartNode}
                          onChange={(v) => update({ autoStartNode: v })}
                          label={t("settings.autoStart")}
                        />
                      </Setting>
                    </Rows>
                  </Group>
                  <Group title={t("settings.group.background")}>
                    <Rows>
                      <Setting
                        title={t("settings.preventSleep")}
                        more={t("settings.preventSleep.more")}
                        desc={t("settings.preventSleep.desc")}
                      >
                        <Toggle
                          checked={cfg.preventSleep}
                          onChange={(v) => update({ preventSleep: v })}
                          label={t("settings.preventSleep")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.notifications")}
                        more={t("settings.notifications.more")}
                        desc={t("settings.notifications.desc")}
                      >
                        <Toggle
                          checked={cfg.notifications}
                          onChange={(v) => update({ notifications: v })}
                          label={t("settings.notifications")}
                        />
                      </Setting>
                      <Setting title={t("settings.updateCheck")} desc={t("settings.updateCheck.desc")}>
                        <Toggle
                          checked={!cfg.noUpdateCheck}
                          onChange={(v) => update({ noUpdateCheck: !v })}
                          label={t("settings.updateCheck")}
                        />
                      </Setting>
                    </Rows>
                  </Group>
                </>
              )}

              {section === "appearance" && (
                <Group title={t("settings.group.display")}>
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
                </Group>
              )}

              {section === "node" && (
                <>
                  <Group title={t("settings.group.storage")}>
                    <Rows>
                      <Setting title={t("settings.dataDir")} desc={t("settings.dataDir.desc")} restart={restart("dataDir")}>
                        <TextInput width="w-72" value={cfg.dataDir} onChange={(v) => update({ dataDir: v })} />
                      </Setting>
                    </Rows>
                    <Advanced id="storage" changed={countSet([cfg.ancientDir, cfg.minFreeDiskMB])}>
                      <Setting
                        title={t("settings.ancientDir")}
                        more={t("settings.ancientDir.more")}
                        flag="--datadir.ancient"
                        desc={t("settings.ancientDir.desc")}
                        restart={restart("ancientDir")}
                      >
                        <TextInput
                          width="w-72"
                          value={cfg.ancientDir}
                          placeholder={t("settings.ancientDir.placeholder")}
                          onChange={(v) => update({ ancientDir: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.minFreeDisk")}
                        more={t("settings.minFreeDisk.more")}
                        flag="--datadir.minfreedisk"
                        desc={t("settings.minFreeDisk.desc")}
                        restart={restart("minFreeDiskMB")}
                      >
                        <NumberInput
                          optional
                          value={cfg.minFreeDiskMB}
                          placeholder={2 * cfg.trieDirtyCacheMB}
                          unit="MB"
                          onChange={(v) => update({ minFreeDiskMB: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.sync")}>
                    <Rows>
                      <Setting
                        title={t("settings.syncMode")}
                        more={t("settings.syncMode.more")}
                        flag="--syncmode"
                        desc={t("settings.syncMode.desc")}
                        restart={restart("syncMode")}
                      >
                        <Segmented
                          value={cfg.syncMode}
                          onChange={(v) => update({ syncMode: v })}
                          options={[
                            { value: "snap", label: t("settings.syncMode.snap") },
                            { value: "full", label: t("settings.syncMode.full") },
                          ]}
                        />
                      </Setting>
                    </Rows>
                    <Advanced id="sync" changed={countSet([cfg.archiveMode, cfg.txLookupLimit, cfg.noSnapshot])}>
                      <Setting
                        title={t("settings.archive")}
                        more={t("settings.archive.more")}
                        flag="--gcmode archive"
                        desc={t("settings.archive.desc")}
                        restart={restart("archiveMode")}
                      >
                        <Toggle
                          checked={cfg.archiveMode}
                          onChange={(v) => update({ archiveMode: v })}
                          label={t("settings.archive")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.txLookupLimit")}
                        more={t("settings.txLookupLimit.more")}
                        flag="--txlookuplimit"
                        desc={t("settings.txLookupLimit.desc")}
                        restart={restart("txLookupLimit")}
                      >
                        <NumberInput
                          optional
                          disabled={cfg.archiveMode}
                          value={cfg.archiveMode ? 0 : cfg.txLookupLimit}
                          placeholder={52560}
                          unit={t("settings.unit.blocks")}
                          onChange={(v) => update({ txLookupLimit: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.snapshot")}
                        more={t("settings.snapshot.more")}
                        flag="--snapshot"
                        desc={t("settings.snapshot.desc")}
                        restart={restart("noSnapshot")}
                      >
                        <Toggle
                          checked={!cfg.noSnapshot || cfg.syncMode === "snap"}
                          disabled={cfg.syncMode === "snap"}
                          onChange={(v) => update({ noSnapshot: !v })}
                          label={t("settings.snapshot")}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group
                    title={t("settings.group.performance")}
                    more={t("settings.group.performance.more")}
                    desc={t("settings.performance.desc")}
                  >
                    <Rows>
                      {(
                        [
                          ["databaseCacheMB", "settings.dbCache"],
                          ["trieCleanCacheMB", "settings.trieClean"],
                          ["trieDirtyCacheMB", "settings.trieDirty"],
                          ["snapshotCacheMB", "settings.snapshotCache"],
                        ] as const
                      ).map(([key, label]) => (
                        <Setting key={key} title={t(label)} restart={restart(key)}>
                          <NumberInput width="w-24" value={cfg[key]} unit="MB" onChange={(v) => update({ [key]: v ?? 0 })} />
                        </Setting>
                      ))}
                    </Rows>
                    <Advanced id="performance" changed={countSet([cfg.noPrefetch, cfg.preimages, cfg.fdLimit])}>
                      <Setting
                        title={t("settings.prefetch")}
                        more={t("settings.prefetch.more")}
                        flag="--cache.noprefetch"
                        desc={t("settings.prefetch.desc")}
                        restart={restart("noPrefetch")}
                      >
                        <Toggle
                          checked={!cfg.noPrefetch}
                          onChange={(v) => update({ noPrefetch: !v })}
                          label={t("settings.prefetch")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.preimages")}
                        more={t("settings.preimages.more")}
                        flag="--cache.preimages"
                        desc={t("settings.preimages.desc")}
                        restart={restart("preimages")}
                      >
                        <Toggle
                          checked={cfg.preimages || cfg.archiveMode}
                          disabled={cfg.archiveMode}
                          onChange={(v) => update({ preimages: v })}
                          label={t("settings.preimages")}
                        />
                      </Setting>
                      <Setting title={t("settings.fdLimit")} desc={t("settings.fdLimit.desc")} restart={restart("fdLimit")}>
                        <NumberInput
                          optional
                          value={cfg.fdLimit || null}
                          placeholder={t("settings.default.system")}
                          onChange={(v) => update({ fdLimit: v ?? 0 })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.fees")}>
                    <Rows>
                      <Setting
                        title={t("settings.smartFee")}
                        more={t("settings.smartFee.more")}
                        flag="--gpo.smartfee"
                        desc={t("settings.smartFee.desc")}
                        restart={restart("enableSmartFee")}
                      >
                        <Toggle
                          checked={cfg.enableSmartFee}
                          onChange={(v) => update({ enableSmartFee: v })}
                          label={t("settings.smartFee")}
                        />
                      </Setting>
                    </Rows>
                    <Advanced
                      id="fees"
                      changed={countSet([cfg.gpoBlocks, cfg.gpoPercentile, cfg.gpoMaxPrice, cfg.gpoIgnorePrice])}
                    >
                      <Setting
                        title={t("settings.gpo.blocks")}
                        desc={t("settings.gpo.blocks.desc")}
                        restart={restart("gpoBlocks")}
                      >
                        <NumberInput
                          optional
                          min={1}
                          value={cfg.gpoBlocks}
                          placeholder={20}
                          unit={t("settings.unit.blocks")}
                          onChange={(v) => update({ gpoBlocks: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.gpo.percentile")}
                        desc={t("settings.gpo.percentile.desc")}
                        restart={restart("gpoPercentile")}
                      >
                        <NumberInput
                          optional
                          value={cfg.gpoPercentile}
                          placeholder={60}
                          unit="%"
                          onChange={(v) => update({ gpoPercentile: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.gpo.maxPrice")}
                        desc={t("settings.gpo.maxPrice.desc")}
                        restart={restart("gpoMaxPrice")}
                      >
                        <WeiInput
                          value={cfg.gpoMaxPrice}
                          placeholder="1000000000000"
                          onChange={(v) => update({ gpoMaxPrice: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.gpo.ignorePrice")}
                        desc={t("settings.gpo.ignorePrice.desc")}
                        restart={restart("gpoIgnorePrice")}
                      >
                        <WeiInput value={cfg.gpoIgnorePrice} placeholder="2" onChange={(v) => update({ gpoIgnorePrice: v })} />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.txpool")} desc={t("settings.txpool.desc")}>
                    <Advanced
                      id="txpool"
                      changed={countSet([
                        cfg.txPoolLocals,
                        cfg.txPoolNoLocals,
                        cfg.txPoolPriceLimit,
                        cfg.txPoolPriceBump,
                        cfg.txPoolAccountSlots,
                        cfg.txPoolGlobalSlots,
                        cfg.txPoolAccountQueue,
                        cfg.txPoolGlobalQueue,
                        cfg.txPoolLifetimeMin,
                      ])}
                    >
                      <Setting
                        title={t("settings.txpool.locals")}
                        desc={t("settings.txpool.locals.desc")}
                        restart={restart("txPoolLocals")}
                      >
                        <ListInput
                          multiline
                          width="w-72"
                          value={cfg.txPoolLocals}
                          placeholder="0x…"
                          onChange={(v) => update({ txPoolLocals: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.txpool.noLocals")}
                        desc={t("settings.txpool.noLocals.desc")}
                        restart={restart("txPoolNoLocals")}
                      >
                        <Toggle
                          checked={cfg.txPoolNoLocals}
                          onChange={(v) => update({ txPoolNoLocals: v })}
                          label={t("settings.txpool.noLocals")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.txpool.priceLimit")}
                        desc={t("settings.txpool.priceLimit.desc")}
                        restart={restart("txPoolPriceLimit")}
                      >
                        <NumberInput
                          optional
                          value={cfg.txPoolPriceLimit}
                          placeholder={1}
                          unit="wei"
                          onChange={(v) => update({ txPoolPriceLimit: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.txpool.priceBump")}
                        desc={t("settings.txpool.priceBump.desc")}
                        restart={restart("txPoolPriceBump")}
                      >
                        <NumberInput
                          optional
                          value={cfg.txPoolPriceBump}
                          placeholder={10}
                          unit="%"
                          onChange={(v) => update({ txPoolPriceBump: v })}
                        />
                      </Setting>
                      {(
                        [
                          ["txPoolAccountSlots", "settings.txpool.accountSlots", 32],
                          ["txPoolGlobalSlots", "settings.txpool.globalSlots", 10240],
                          ["txPoolAccountQueue", "settings.txpool.accountQueue", 128],
                          ["txPoolGlobalQueue", "settings.txpool.globalQueue", 2048],
                        ] as const
                      ).map(([key, label, def]) => (
                        <Setting key={key} title={t(label)} desc={t(`${label}.desc`)} restart={restart(key)}>
                          <NumberInput optional value={cfg[key]} placeholder={def} onChange={(v) => update({ [key]: v })} />
                        </Setting>
                      ))}
                      <Setting
                        title={t("settings.txpool.lifetime")}
                        desc={t("settings.txpool.lifetime.desc")}
                        restart={restart("txPoolLifetimeMin")}
                      >
                        <NumberInput
                          optional
                          min={1}
                          value={cfg.txPoolLifetimeMin}
                          placeholder={180}
                          unit="min"
                          onChange={(v) => update({ txPoolLifetimeMin: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>
                </>
              )}

              {section === "network" && (
                <>
                  <Group title={t("settings.group.connections")}>
                    <Rows>
                      <Setting
                        title={t("settings.allowInbound")}
                        more={t("settings.allowInbound.more")}
                        flag="--nat none"
                        desc={t("settings.allowInbound.desc")}
                        restart={restart("blockInbound")}
                      >
                        <Toggle
                          checked={inbound}
                          onChange={(v) => update({ blockInbound: !v })}
                          label={t("settings.allowInbound")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.listenPort")}
                        desc={t("settings.listenPort.desc")}
                        restart={restart("listenPort")}
                      >
                        <NumberInput
                          optional
                          min={1}
                          width="w-24"
                          value={cfg.listenPort || null}
                          placeholder={32110}
                          onChange={(v) => update({ listenPort: v ?? 0 })}
                        />
                      </Setting>
                      <Setting title={t("settings.maxPeers")} desc={t("settings.maxPeers.desc")} restart={restart("maxPeers")}>
                        <NumberInput width="w-24" min={1} value={cfg.maxPeers} onChange={(v) => update({ maxPeers: v ?? 0 })} />
                      </Setting>
                      <Setting title={t("settings.nodeName")} desc={t("settings.nodeName.desc")} restart={restart("nodeName")}>
                        <TextInput
                          mono={false}
                          value={cfg.nodeName}
                          placeholder={t("settings.optional")}
                          onChange={(v) => update({ nodeName: v })}
                        />
                      </Setting>
                    </Rows>
                    <Advanced id="connections" changed={countSet([cfg.natMode, cfg.maxPendingPeers])}>
                      <Setting
                        title={t("settings.nat")}
                        more={t("settings.nat.more")}
                        flag="--nat"
                        desc={t("settings.nat.desc")}
                        restart={restart("natMode", "externalIp")}
                      >
                        <select
                          className="input w-48 disabled:opacity-50"
                          disabled={!inbound}
                          value={cfg.natMode}
                          onChange={(e) => update({ natMode: e.target.value as GUIConfig["natMode"] })}
                        >
                          <option value="">{t("settings.nat.any")}</option>
                          <option value="upnp">UPnP</option>
                          <option value="pmp">NAT-PMP</option>
                          <option value="extip">{t("settings.nat.extip")}</option>
                        </select>
                      </Setting>
                      {inbound && cfg.natMode === "extip" && (
                        <Setting
                          title={t("settings.externalIp")}
                          desc={t("settings.externalIp.desc")}
                          restart={restart("externalIp")}
                        >
                          <TextInput
                            width="w-48"
                            value={cfg.externalIp}
                            placeholder="203.0.113.7"
                            onChange={(v) => update({ externalIp: v })}
                          />
                        </Setting>
                      )}
                      <Setting
                        title={t("settings.maxPendingPeers")}
                        desc={t("settings.maxPendingPeers.desc")}
                        restart={restart("maxPendingPeers")}
                      >
                        <NumberInput
                          optional
                          width="w-24"
                          value={cfg.maxPendingPeers || null}
                          placeholder={50}
                          onChange={(v) => update({ maxPendingPeers: v ?? 0 })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.discovery")}>
                    <Rows>
                      <Setting
                        title={t("settings.discovery")}
                        more={t("settings.discovery.more")}
                        flag="--nodiscover"
                        desc={t("settings.discovery.desc")}
                        restart={restart("noDiscovery")}
                      >
                        <Toggle
                          checked={!cfg.noDiscovery}
                          onChange={(v) => update({ noDiscovery: !v })}
                          label={t("settings.discovery")}
                        />
                      </Setting>
                    </Rows>
                    <Advanced id="discovery" changed={countSet([cfg.legacyDiscovery, cfg.netRestrict, cfg.bootnodes])}>
                      <Setting
                        title={t("settings.legacyDiscovery")}
                        more={t("settings.legacyDiscovery.more")}
                        flag="--legacy-discovery"
                        desc={t("settings.legacyDiscovery.desc")}
                        restart={restart("legacyDiscovery")}
                      >
                        <Segmented
                          value={cfg.legacyDiscovery || ""}
                          onChange={(v) => update({ legacyDiscovery: v })}
                          options={[
                            { value: "", label: t("settings.legacyDiscovery.auto") },
                            { value: "on", label: t("settings.on") },
                            { value: "off", label: t("settings.off") },
                          ]}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.netRestrict")}
                        desc={t("settings.netRestrict.desc")}
                        restart={restart("netRestrict")}
                      >
                        <TextInput
                          value={cfg.netRestrict}
                          placeholder="10.0.0.0/8, 192.168.0.0/16"
                          onChange={(v) => update({ netRestrict: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.bootnodes")}
                        more={t("settings.bootnodes.more")}
                        flag="--bootnodes"
                        desc={t("settings.bootnodes.desc")}
                        restart={restart("bootnodes")}
                      >
                        <ListInput
                          multiline
                          width="w-72"
                          value={cfg.bootnodes}
                          placeholder={t("settings.bootnodes.placeholder")}
                          onChange={(v) => update({ bootnodes: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.privacy")} desc={t("settings.privacy.desc")}>
                    <Rows>
                      <Setting
                        title={t("settings.proxy")}
                        more={t("settings.proxy.more")}
                        flag="--proxy"
                        desc={t("settings.proxy.desc")}
                        restart={restart("proxy")}
                      >
                        <TextInput
                          width="w-44"
                          value={cfg.proxy}
                          placeholder="127.0.0.1:9050"
                          onChange={(v) => update({ proxy: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.listenOnion")}
                        more={t("settings.listenOnion.more")}
                        flag="--listenonion"
                        desc={t("settings.listenOnion.desc")}
                        restart={restart("noListenOnion")}
                      >
                        <Toggle
                          checked={!cfg.noListenOnion}
                          onChange={(v) => update({ noListenOnion: !v })}
                          label={t("settings.listenOnion")}
                        />
                      </Setting>
                    </Rows>
                    <Advanced
                      id="privacy"
                      changed={countSet([cfg.onionProxy, cfg.onlyNet, cfg.proxyNoRandomize, cfg.torControl, cfg.torPassword])}
                    >
                      <Setting
                        title={t("settings.onlyNet")}
                        more={t("settings.onlyNet.more")}
                        flag="--onlynet"
                        desc={t("settings.onlyNet.desc")}
                        restart={restart("onlyNet")}
                      >
                        <NetworkPicker value={cfg.onlyNet ?? []} onChange={(v) => update({ onlyNet: v.length ? v : null })} />
                      </Setting>
                      <Setting
                        title={t("settings.onionProxy")}
                        more={t("settings.onionProxy.more")}
                        flag="--onion"
                        desc={t("settings.onionProxy.desc")}
                        restart={restart("onionProxy")}
                      >
                        <TextInput
                          width="w-44"
                          value={cfg.onionProxy}
                          placeholder={t("settings.onionProxy.placeholder")}
                          onChange={(v) => update({ onionProxy: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.proxyRandomize")}
                        more={t("settings.proxyRandomize.more")}
                        flag="--proxyrandomize"
                        desc={t("settings.proxyRandomize.desc")}
                        restart={restart("proxyNoRandomize")}
                      >
                        <Toggle
                          checked={!cfg.proxyNoRandomize}
                          onChange={(v) => update({ proxyNoRandomize: !v })}
                          label={t("settings.proxyRandomize")}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.torControl")}
                        desc={t("settings.torControl.desc")}
                        restart={restart("torControl")}
                      >
                        <TextInput
                          width="w-44"
                          value={cfg.torControl}
                          placeholder="127.0.0.1:9051"
                          onChange={(v) => update({ torControl: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.torPassword")}
                        desc={t("settings.torPassword.desc")}
                        restart={restart("torPassword")}
                      >
                        <TextInput
                          type="password"
                          width="w-44"
                          value={cfg.torPassword}
                          placeholder={t("settings.torPassword.placeholder")}
                          onChange={(v) => update({ torPassword: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.reporting")}>
                    <Rows>
                      <Setting
                        title={t("settings.stats.toggle")}
                        more={t("settings.stats.toggle.more")}
                        flag="--prlstats"
                        desc={t("settings.stats.desc")}
                        restart={restart("reportStats")}
                      >
                        <Toggle
                          checked={cfg.reportStats}
                          onChange={(v) => update({ reportStats: v })}
                          label={t("settings.stats.toggle")}
                        />
                      </Setting>
                    </Rows>
                  </Group>
                </>
              )}

              {section === "rpc" && (
                <>
                  <Group title={t("settings.group.http")}>
                    <Rows>
                      <Setting
                        title={t("settings.rpc.enable")}
                        more={t("settings.rpc.enable.more")}
                        flag="--http"
                        desc={t("settings.rpc.desc")}
                        restart={restart("httpRpcEnabled")}
                      >
                        <Toggle
                          checked={cfg.httpRpcEnabled}
                          onChange={(v) => update({ httpRpcEnabled: v })}
                          label={t("settings.rpc.enable")}
                        />
                      </Setting>
                      {cfg.httpRpcEnabled && (
                        <Setting
                          title={t("settings.rpc.port")}
                          desc={t("settings.rpc.port.desc")}
                          restart={restart("httpRpcPort")}
                        >
                          <NumberInput
                            width="w-24"
                            min={1}
                            value={cfg.httpRpcPort}
                            onChange={(v) => update({ httpRpcPort: v || 8545 })}
                          />
                        </Setting>
                      )}
                    </Rows>
                    {!LOOPBACK.has(cfg.httpHost) && cfg.httpRpcEnabled && (
                      <Notice tone="warn">{t("settings.rpc.exposed")}</Notice>
                    )}
                    <Advanced id="http" changed={countSet([cfg.httpHost, cfg.httpApis, cfg.httpCors, cfg.httpVhosts])}>
                      <Setting
                        title={t("settings.rpc.host")}
                        more={t("settings.rpc.host.more")}
                        flag="--http.addr"
                        desc={t("settings.rpc.host.desc")}
                        restart={restart("httpHost")}
                      >
                        <TextInput
                          width="w-40"
                          value={cfg.httpHost}
                          placeholder="127.0.0.1"
                          onChange={(v) => update({ httpHost: v.trim() })}
                        />
                      </Setting>
                      <Setting title={t("settings.rpc.apis")} desc={t("settings.rpc.apis.desc")} restart={restart("httpApis")}>
                        <ListInput
                          value={cfg.httpApis}
                          placeholder="net, web3, eth, debug"
                          onChange={(v) => update({ httpApis: v })}
                        />
                      </Setting>
                      <Setting title={t("settings.rpc.cors")} desc={t("settings.rpc.cors.desc")} restart={restart("httpCors")}>
                        <ListInput value={cfg.httpCors} placeholder="*" onChange={(v) => update({ httpCors: v })} />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.vhosts")}
                        more={t("settings.rpc.vhosts.more")}
                        flag="--http.vhosts"
                        desc={t("settings.rpc.vhosts.desc")}
                        restart={restart("httpVhosts")}
                      >
                        <ListInput
                          value={cfg.httpVhosts}
                          placeholder="localhost, 127.0.0.1"
                          onChange={(v) => update({ httpVhosts: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>

                  <Group title={t("settings.group.ws")}>
                    <Rows>
                      <Setting title={t("settings.ws")} desc={t("settings.ws.desc")} restart={restart("wsEnabled")}>
                        <Toggle checked={cfg.wsEnabled} onChange={(v) => update({ wsEnabled: v })} label={t("settings.ws")} />
                      </Setting>
                    </Rows>
                    {cfg.wsEnabled && (
                      <Advanced id="ws" changed={countSet([cfg.wsHost, cfg.wsPort, cfg.wsApis, cfg.wsOrigins])}>
                        <Setting title={t("settings.ws.host")} restart={restart("wsHost", "wsPort")}>
                          <TextInput
                            width="w-40"
                            value={cfg.wsHost}
                            placeholder="127.0.0.1"
                            onChange={(v) => update({ wsHost: v.trim() })}
                          />
                          <span className="text-muted-foreground">:</span>
                          <NumberInput
                            optional
                            min={1}
                            width="w-24"
                            value={cfg.wsPort || null}
                            placeholder={8546}
                            onChange={(v) => update({ wsPort: v ?? 0 })}
                          />
                        </Setting>
                        <Setting title={t("settings.ws.apis")} restart={restart("wsApis")}>
                          <ListInput
                            value={cfg.wsApis}
                            placeholder="net, web3, eth, debug"
                            onChange={(v) => update({ wsApis: v })}
                          />
                        </Setting>
                        <Setting
                          title={t("settings.ws.origins")}
                          desc={t("settings.ws.origins.desc")}
                          restart={restart("wsOrigins")}
                        >
                          <ListInput value={cfg.wsOrigins} placeholder="*" onChange={(v) => update({ wsOrigins: v })} />
                        </Setting>
                      </Advanced>
                    )}
                  </Group>

                  <Group title={t("settings.group.otherApis")}>
                    <Rows>
                      <Setting title={t("settings.graphql")} desc={t("settings.graphql.desc")} restart={restart("graphql")}>
                        <Toggle
                          checked={cfg.graphql}
                          disabled={!cfg.httpRpcEnabled && !cfg.graphql}
                          onChange={(v) => update({ graphql: v })}
                          label={t("settings.graphql")}
                        />
                      </Setting>
                      <Setting title={t("settings.ipc")} desc={t("settings.ipc.desc")} restart={restart("ipcDisabled")}>
                        <Toggle
                          checked={!cfg.ipcDisabled}
                          onChange={(v) => update({ ipcDisabled: !v })}
                          label={t("settings.ipc")}
                        />
                      </Setting>
                    </Rows>
                  </Group>

                  <Group title={t("settings.group.limits")} desc={t("settings.limits.desc")}>
                    <Advanced
                      id="limits"
                      changed={countSet([
                        cfg.rpcGasCap,
                        cfg.rpcTxFeeCap,
                        cfg.rpcPvmTimeoutSec,
                        cfg.rpcLogQueryLimit,
                        cfg.rpcBatchLimit,
                        cfg.allowUnprotectedTxs,
                      ])}
                    >
                      <Setting
                        title={t("settings.rpc.gasCap")}
                        desc={t("settings.rpc.gasCap.desc")}
                        restart={restart("rpcGasCap")}
                      >
                        <NumberInput
                          optional
                          value={cfg.rpcGasCap}
                          placeholder={600000000}
                          width="w-32"
                          onChange={(v) => update({ rpcGasCap: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.txFeeCap")}
                        desc={t("settings.rpc.txFeeCap.desc")}
                        restart={restart("rpcTxFeeCap")}
                      >
                        <NumberInput
                          optional
                          step="any"
                          value={cfg.rpcTxFeeCap}
                          placeholder={1}
                          unit="LAX"
                          onChange={(v) => update({ rpcTxFeeCap: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.pvmTimeout")}
                        desc={t("settings.rpc.pvmTimeout.desc")}
                        restart={restart("rpcPvmTimeoutSec")}
                      >
                        <NumberInput
                          optional
                          value={cfg.rpcPvmTimeoutSec}
                          placeholder={5}
                          unit="s"
                          onChange={(v) => update({ rpcPvmTimeoutSec: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.logQueryLimit")}
                        desc={t("settings.rpc.logQueryLimit.desc")}
                        restart={restart("rpcLogQueryLimit")}
                      >
                        <NumberInput
                          optional
                          value={cfg.rpcLogQueryLimit}
                          placeholder={1000}
                          onChange={(v) => update({ rpcLogQueryLimit: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.batchLimit")}
                        desc={t("settings.rpc.batchLimit.desc")}
                        restart={restart("rpcBatchLimit")}
                      >
                        <NumberInput
                          optional
                          value={cfg.rpcBatchLimit}
                          placeholder={1000}
                          onChange={(v) => update({ rpcBatchLimit: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.unprotected")}
                        more={t("settings.rpc.unprotected.more")}
                        flag="--rpc.allow-unprotected-txs"
                        desc={t("settings.rpc.unprotected.desc")}
                        restart={restart("allowUnprotectedTxs")}
                      >
                        <Toggle
                          checked={cfg.allowUnprotectedTxs}
                          onChange={(v) => update({ allowUnprotectedTxs: v })}
                          label={t("settings.rpc.unprotected")}
                        />
                      </Setting>
                    </Advanced>
                  </Group>
                </>
              )}

              {section === "mining" && (
                <>
                  <Group title={t("settings.group.mining")}>
                    <Rows>
                      <Setting
                        title={t("settings.resumeMining")}
                        more={t("settings.resumeMining.more")}
                        desc={t("settings.resumeMining.desc")}
                      >
                        <Toggle
                          checked={cfg.resumeMining}
                          onChange={(v) => update({ resumeMining: v })}
                          label={t("settings.resumeMining")}
                        />
                      </Setting>
                    </Rows>
                  </Group>
                  <Group title={t("settings.group.solo")} desc={t("settings.miner.desc")}>
                    <Advanced
                      id="solo"
                      changed={countSet([cfg.minerExtraData, cfg.minerGasLimit, cfg.minerGasPrice, cfg.minerRecommitSec])}
                    >
                      <Setting
                        title={t("settings.miner.extraData")}
                        desc={t("settings.miner.extraData.desc")}
                        restart={restart("minerExtraData")}
                      >
                        <TextInput
                          value={cfg.minerExtraData}
                          placeholder={t("settings.miner.extraData.placeholder")}
                          onChange={(v) => update({ minerExtraData: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.miner.gasLimit")}
                        desc={t("settings.miner.gasLimit.desc")}
                        restart={restart("minerGasLimit")}
                      >
                        <NumberInput
                          optional
                          width="w-32"
                          value={cfg.minerGasLimit || null}
                          placeholder={600000000}
                          onChange={(v) => update({ minerGasLimit: v ?? 0 })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.miner.gasPrice")}
                        desc={t("settings.miner.gasPrice.desc")}
                        restart={restart("minerGasPrice")}
                      >
                        <WeiInput
                          value={cfg.minerGasPrice}
                          placeholder="1000000000"
                          onChange={(v) => update({ minerGasPrice: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.miner.recommit")}
                        desc={t("settings.miner.recommit.desc")}
                        restart={restart("minerRecommitSec")}
                      >
                        <NumberInput
                          optional
                          min={1}
                          value={cfg.minerRecommitSec || null}
                          placeholder={20}
                          unit="s"
                          onChange={(v) => update({ minerRecommitSec: v ?? 0 })}
                        />
                      </Setting>
                    </Advanced>
                  </Group>
                </>
              )}

              {section === "diagnostics" && (
                <>
                  <Group title={t("settings.group.logging")}>
                    <Rows>
                      <Setting title={t("settings.logLevel")} desc={t("settings.logLevel.desc")}>
                        <select
                          className="input w-40"
                          value={cfg.logLevel || 3}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            instant({ logLevel: v === 3 ? 0 : v });
                          }}
                        >
                          {[1, 2, 3, 4, 5].map((l) => (
                            <option key={l} value={l}>
                              {t(`settings.logLevel.${l}`)}
                            </option>
                          ))}
                        </select>
                      </Setting>
                    </Rows>
                  </Group>
                  <Group title={t("settings.group.metrics")}>
                    <Rows>
                      <Setting
                        title={t("settings.metrics")}
                        more={t("settings.metrics.more")}
                        flag="--metrics"
                        desc={t("settings.metrics.desc")}
                        restart={restart("metrics")}
                      >
                        <Toggle checked={cfg.metrics} onChange={(v) => update({ metrics: v })} label={t("settings.metrics")} />
                      </Setting>
                    </Rows>
                    {cfg.metrics && (
                      <Advanced id="metrics" changed={countSet([cfg.metricsExpensive, cfg.metricsAddr, cfg.metricsPort])}>
                        <Setting
                          title={t("settings.metrics.expensive")}
                          desc={t("settings.metrics.expensive.desc")}
                          restart={restart("metricsExpensive")}
                        >
                          <Toggle
                            checked={cfg.metricsExpensive}
                            onChange={(v) => update({ metricsExpensive: v })}
                            label={t("settings.metrics.expensive")}
                          />
                        </Setting>
                        <Setting
                          title={t("settings.metrics.http")}
                          flag="--metrics.addr"
                          desc={t("settings.metrics.http.desc")}
                          restart={restart("metricsAddr", "metricsPort")}
                        >
                          <TextInput
                            width="w-40"
                            value={cfg.metricsAddr}
                            placeholder={t("settings.off")}
                            onChange={(v) => update({ metricsAddr: v.trim() })}
                          />
                          <span className="text-muted-foreground">:</span>
                          <NumberInput
                            optional
                            min={1}
                            width="w-24"
                            value={cfg.metricsPort || null}
                            placeholder={6060}
                            onChange={(v) => update({ metricsPort: v ?? 0 })}
                          />
                        </Setting>
                      </Advanced>
                    )}
                  </Group>
                  <Group title={t("settings.group.logs")} desc={t("settings.diagnostics.desc")} className="min-h-80 flex-1">
                    <LogsPanel />
                  </Group>
                </>
              )}
              {section === "about" && <About />}
            </div>
          </motion.div>
        </AnimatePresence>

        <SaveBar
          dirty={dirty}
          saved={saved}
          dirtyNeedsRestart={dirtyNeedsRestart || dirtyNeedsAppRestart}
          restartPending={appRestartPending ? "app" : restartPending ? "node" : null}
          restarting={restarting}
          onSave={save}
          onDiscard={() => {
            setCfg(orig);
            setErr(null);
          }}
          onRestart={appRestartPending ? restartApp : restartNode}
        />
      </div>
    </div>
  );
}

/** WeiInput edits a whole number of wei as text: amounts outgrow a JS number. */
function WeiInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <>
      <input
        inputMode="numeric"
        spellCheck={false}
        className="input w-40 text-right font-mono text-sm tabular-nums"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      />
      <span className="min-w-6 text-sm text-muted-foreground">wei</span>
    </>
  );
}

/** NetworkPicker chooses any of the networks outbound connections may use; none means all. */
function NetworkPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <div className="flex gap-1">
      {(["ipv4", "ipv6", "onion"] as const).map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n])}
            className={`btn ${on ? "btn-primary" : "btn-secondary"}`}
          >
            {on && <Check className="size-3.5" />}
            {t(`settings.onlyNet.${n}`)}
          </button>
        );
      })}
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
    api
      .version()
      .then(setAppVersion)
      .catch(() => {});
    api
      .clientVersion()
      .then(setClientVersion)
      .catch(() => {});
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
  restartPending: "node" | "app" | null;
  restarting: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onRestart: () => void;
}) {
  const t = useT();
  const visible = dirty || saved || !!restartPending;
  const kind = dirty ? "dirty" : restartPending ? `restart-${restartPending}` : "saved";
  // A footer along the pane, as a preferences window's Apply/Revert row: it
  // slides up while there is something to apply, its message swapping in place
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="save-bar"
          className="shrink-0 overflow-hidden border-t border-border bg-background"
          initial={{ height: 0 }}
          animate={{ height: 48 }}
          exit={{ height: 0 }}
          transition={SPRING}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={kind}
              className="flex h-12 items-center gap-2 px-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: FADE_IN }}
              exit={{ opacity: 0, y: -10, transition: FADE_OUT }}
            >
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
                    {restartPending === "app" ? t("settings.save.appRestartRequired") : t("settings.save.restartRequired")}
                  </span>
                  <button type="button" onClick={onRestart} disabled={restarting} className="btn btn-primary">
                    {restarting && <Loader2 className="size-3.5 animate-spin" />}
                    {restarting
                      ? t("settings.save.restarting")
                      : restartPending === "app"
                        ? t("settings.save.restartApp")
                        : t("settings.save.restart")}
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-2 text-good-ink">
                  <Check className="size-3.5" />
                  {t("settings.save.saved")}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
