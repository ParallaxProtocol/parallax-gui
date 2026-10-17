import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Check,
  ExternalLink,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Lock,
  Loader2,
  Palette,
  Plug,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  beforeNodeStart,
  CONFIG_UPDATED_EVENT,
  GUIConfig,
  openExternal,
  UpdateInfo,
  type TorStatus,
} from "../../lib/api";
import { formatUnits, parseUnits } from "../../lib/format";
import { applyTheme } from "../../lib/theme";
import { FADE_IN, FADE_OUT, GLIDE, SPRING, usePageSwap } from "../../lib/motion";
import { useLang, useT, Lang } from "../../i18n";
import { LANG_NAMES } from "../../i18n/translations";
import { pageKey, useSettingsSheet, type SettingsSection } from "../../lib/settingsSheet";
import { LogoMark } from "../../components/ui/LogoMark";
import { Select } from "../../components/ui/Select";
import { Tooltip } from "../../components/ui/Tooltip";
import { OnionSymbol, SparklesSymbol } from "../../components/ui/symbols";
import { IconTile, TILE } from "../../components/ui/IconTile";
import { AccountsSettings, SecuritySettings } from "../Wallet/Accounts";
import { NodeStorageActions, WalletStorage, WipeWallet } from "./storage";
import { Indicator } from "../../components/ui/Indicator";
import { Row, Rows } from "../../components/ui/Panel";
import { Segmented } from "../../components/ui/Segmented";
import Toggle from "../../components/ui/Toggle";
import { CopyButton, Meter, Notice } from "../../components/ui/bits";
import { useTorStatus } from "../../lib/torStatus";
import { ReleaseNotesModal } from "../../components/ReleaseNotes";
import LogsPanel from "./LogsPanel";
import { AssistantsOverview, AssistantsPermissions } from "./AssistantsSettings";
import {
  Advanced,
  countSet,
  Fold,
  FolderInput,
  Group,
  ListInput,
  NumberInput,
  Reveal,
  Setting,
  TextInput,
} from "./fields";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { useOfflineMode } from "../../lib/offline";
import { useWallet } from "../../lib/wallet";
import type { AvatarStyle } from "../../lib/prefs";
import { PAGE_NARROW } from "../../lib/layout";
import { useNode, useRefresh } from "../../lib/live";

// Fields the app applies itself, at once or on its next action: changing
// them needs no node restart. Every other field configures the node.
const LIVE_FIELDS = new Set<keyof GUIConfig>([
  "bootstrapped",
  "theme",
  "disableAnimations",
  "avatarStyle",
  "autoStartNode",
  "logLevel",
  "noUpdateCheck",
  "preventSleep",
  "notifications",
  "staticPeers",
  "trustedPeers",
  // The backend takes the node down at once on becoming an offline signer,
  // and reads the fee cap on each signature
  "offlineSigner",
  "offlineFeeCapWei",
  // The backend starts, stops or moves the assistant server on save
  "mcpEnabled",
  "mcpPort",
  // Read by the assistant tools on each call
  "mcpAllow",
]);

// Of the fields above, those typed: saved once the typing pauses, so a
// half-typed value (a port's first digits) is never applied. The node's
// own, saved at once only while it's stopped, all wait for the pause
const TYPED_FIELDS = new Set<keyof GUIConfig>(["mcpPort", "offlineFeeCapWei", "staticPeers", "trustedPeers"]);
const TYPING_PAUSE_MS = 800;

// Fields the daemon reads only as its process starts, from its argv:
// they wait on a restart of the whole app
const APP_FIELDS = new Set<keyof GUIConfig>(["metrics", "metricsExpensive", "metricsAddr", "metricsPort"]);

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
  // Changes that save without the save bar: those waiting for the typing to
  // pause, those being saved, and the flush that saves what's waiting, run
  // as Settings closes and before the node starts too
  const waiting = useRef<Partial<GUIConfig>>({});
  const saving = useRef(new Set<keyof GUIConfig>());
  const waitTimer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const before = () => flush.current();
    beforeNodeStart.add(before);
    return () => {
      beforeNodeStart.delete(before);
      flush.current();
    };
  }, []);
  // A stopped node reads the saved settings when it next starts: nothing
  // waits on its restart then
  const nodeRunning = !!useNode()?.running;
  // Whether this build ships a Tor of its own, for the Tor settings
  const tor = useTorStatus();
  const torBundled = tor?.bundled ?? true;
  // With Tor on, a restart waits for it to connect: the node starts behind it or not at all
  const torWaiting =
    !tor?.enabled || tor.state === "ready"
      ? null
      : tor.state === "starting"
        ? t("node.waitTor", { n: tor.progress })
        : t("node.waitTorFailed");
  useEffect(() => {
    if (!nodeRunning) setRestartPending(false);
    // Started some other way (on launch, by an assistant) with the node's
    // changes still waiting: saved now, and the restart they need asked for
    else if (Object.keys(waiting.current).some((k) => !LIVE_FIELDS.has(k as keyof GUIConfig))) {
      flush.current().then(() => setRestartPending(true));
    }
  }, [nodeRunning]);
  const { section: chosen, setSection, page } = useSettingsSheet();
  // An offline signer never runs its node: its sections aren't shown, and
  // one left open shows General instead
  const offline = useOfflineMode();
  // Security is the wallet's password: until there is one (Welcome sets
  // it), it isn't shown, and one left open shows Accounts instead
  const { info: walletInfo } = useWallet();
  const hidden = (id: SettingsSection) =>
    (offline && (NODE_SECTIONS.has(id) || id === "privacy")) || (id === "security" && !walletInfo?.hasPassword);
  const section = !hidden(chosen) ? chosen : chosen === "security" ? "accounts" : "general";
  const [login, setLogin] = useState<{ supported: boolean; enabled: boolean }>({ supported: false, enabled: false });
  const swap = usePageSwap();

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

  // Changes made elsewhere (an assistant's request approved, a permission
  // allowed always) show here: fields not being edited take the saved
  // value, so saving the page later doesn't undo them
  const latest = useRef({ cfg, orig });
  latest.current = { cfg, orig };
  useEffect(() => {
    const refresh = () =>
      api
        .getConfig()
        .then((fresh) => {
          const { cfg: c, orig: o } = latest.current;
          if (!c || !o) return;
          const merged = { ...fresh } as GUIConfig;
          for (const k of Object.keys(c) as (keyof GUIConfig)[]) {
            if (!same(c[k], o[k])) (merged as any)[k] = c[k];
          }
          setOrig(fresh);
          setCfg(merged);
        })
        .catch(() => {});
    window.addEventListener(CONFIG_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, refresh);
  }, []);

  if (!cfg || !orig) return null;

  // Saves changes that don't wait for the save bar on top of the config as
  // it is now, then counts them saved
  const saveNow = async (patch: Partial<GUIConfig>) => {
    const ks = Object.keys(patch) as (keyof GUIConfig)[];
    if (ks.length === 0) return;
    ks.forEach((k) => saving.current.add(k));
    try {
      const fresh = await api.getConfig();
      await api.updateConfig({ ...fresh, ...patch });
      setOrig((o) => (o ? { ...o, ...patch } : o));
      window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      ks.forEach((k) => saving.current.delete(k));
    }
  };
  flush.current = () => {
    clearTimeout(waitTimer.current);
    const patch = waiting.current;
    waiting.current = {};
    return saveNow(patch);
  };

  // Whether a change to k saves without the save bar: what the app applies
  // itself, and, while the node is stopped, what configures it, which it
  // reads as it next starts. Not the offline signer, which takes the node
  // down at once, so waits for Save as a decision does; nor what the app
  // must restart for
  const savesNow = (k: keyof GUIConfig) =>
    k !== "offlineSigner" && !APP_FIELDS.has(k) && (LIVE_FIELDS.has(k) || !nodeRunning);

  // A change made only of fields that save now saves at once, or, typed or
  // the node's, once the typing pauses; any other waits for Save, and what
  // it needs restarted. A change that mixes them waits whole, so a field
  // set alongside a decision (the offline signer's) isn't applied without it
  const update = (patch: Partial<GUIConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    const ks = Object.keys(patch) as (keyof GUIConfig)[];
    if (!ks.every(savesNow)) return;
    if (ks.every((k) => LIVE_FIELDS.has(k) && !TYPED_FIELDS.has(k))) {
      saveNow(patch);
      return;
    }
    waiting.current = { ...waiting.current, ...patch };
    clearTimeout(waitTimer.current);
    waitTimer.current = setTimeout(() => flush.current(), TYPING_PAUSE_MS);
  };

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
    return nodeRunning && ch.length > 0;
  };
  // What the save bar is for: changes not on their way to being saved without it
  const pendingNow = (k: keyof GUIConfig) => k in waiting.current || saving.current.has(k);
  const dirty = keys.some((k) => changed(k) && !pendingNow(k));
  const dirtyNeedsRestart = nodeRunning && keys.some((k) => changed(k) && !LIVE_FIELDS.has(k) && !APP_FIELDS.has(k));
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

  // The node's storage, on the Node page and again among the app's Storage
  // beside the wallet's: one set of rows, so the two never differ. On the
  // Node page its finer options fold under Advanced; in Storage (manage)
  // they're all in view, with the rows that move the data and clear the chain
  const nodeStorage = (title: string, manage?: boolean) => {
    const finer = (
      <>
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
      </>
    );
    return (
      <Group title={title}>
        <Rows>
          <Setting title={t("settings.dataDir")} desc={t("settings.dataDir.desc")} restart={restart("dataDir")}>
            <FolderInput title={t("settings.dataDir")} value={cfg.dataDir} onChange={(v) => update({ dataDir: v })} />
          </Setting>
          {manage ? (
            <>
              {finer}
              <NodeStorageActions dataDir={orig.dataDir} />
            </>
          ) : (
            <Advanced id="storage" changed={countSet([cfg.ancientDir, cfg.minFreeDiskMB])}>
              {finer}
            </Advanced>
          )}
        </Rows>
      </Group>
    );
  };

  const inbound = !cfg.blockInbound;
  // With the Tor switch on, Tor sets the node's proxy and Tor ports: the
  // app's own, or the Tor on this computer, which Privacy says where to find
  const torSets = orig.tor || cfg.tor;

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label={t("nav.settings")}
        className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3"
      >
        {NAV_GROUPS.filter((g) => !offline || !g.sections.some((x) => NODE_SECTIONS.has(x))).map((group, gi) => (
          <div key={group.title} className="flex flex-col gap-px">
            <h3 className={`px-2.5 pb-1 text-xs font-semibold text-muted-foreground ${gi === 0 ? "" : "pt-5"}`}>
              {t(group.title)}
            </h3>
            {group.sections
              .filter((id) => !hidden(id))
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={section === id ? "page" : undefined}
                  className={`relative flex h-8 shrink-0 items-center rounded-lg px-2 text-left text-base transition-colors ${
                    section === id ? "font-medium" : "text-foreground/80"
                  }`}
                >
                  {section === id && (
                    <motion.span
                      layoutId="settings-selection"
                      layoutDependency={section}
                      transition={GLIDE}
                      className="absolute inset-0 rounded-lg bg-selected"
                    />
                  )}
                  <span className="relative flex items-center gap-2">
                    <SectionTile id={id} small />
                    {t(`settings.section.${id}`)}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <motion.div
          key={page ? pageKey(page) : section}
          {...swap}
          className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
        >
          <div className={`flex flex-col gap-7 px-6 py-6 ${PAGE_NARROW}`}>
            {/* The section's own header, as in System Settings; a page drilled
                into draws its own, the way back to the section in it */}
            {!page && (
              <div className="flex items-center gap-4">
                <SectionTile id={section} large />
                <h2 className="text-2xl font-semibold tracking-tight">{t(`settings.section.${section}`)}</h2>
              </div>
            )}
            {err && <Notice tone="critical">{err}</Notice>}

            {section === "accounts" && <AccountsSettings />}
            {section === "security" && <SecuritySettings />}
            {section === "storage" && (
              <>
                <Group title={t("nav.wallet")}>
                  <WalletStorage />
                </Group>
                {/* An offline signer has no node, nor its data */}
                {!offline && nodeStorage(t("nav.node"), true)}
                {/* Last, apart from the rest: what can't be undone */}
                {walletInfo?.hasPassword && (
                  <Group title={t("storage.danger")}>
                    <WipeWallet />
                  </Group>
                )}
              </>
            )}

            {/* Tor, for everything the app sends: applied at once, as a theme is */}
            {section === "privacy" && (
              <Group title={t("tor.switch")} desc={t("settings.torGroup.desc")}>
                <Rows>
                  <Setting
                    title={t("settings.tor")}
                    more={t("settings.tor.more")}
                    desc={t("settings.tor.desc")}
                    restart={restart("tor")}
                  >
                    <Toggle checked={cfg.tor} onChange={(v) => update({ tor: v })} label={t("settings.tor")} />
                  </Setting>
                  {/* How the saved switch's Tor is doing, while it's on */}
                  <TorStatusRow on={orig.tor} />
                  <Reveal show={cfg.tor}>
                    <Setting
                      title={t("settings.torPeers")}
                      more={t("settings.torPeers.more")}
                      desc={t("settings.torPeers.desc")}
                      restart={restart("torOnionOnly")}
                    >
                      <Segmented
                        size="sm"
                        value={cfg.torOnionOnly ? "onion" : "all"}
                        onChange={(v) => update({ torOnionOnly: v === "onion" })}
                        options={[
                          { value: "all", label: t("settings.torPeers.all") },
                          { value: "onion", label: t("settings.torPeers.onion") },
                        ]}
                      />
                    </Setting>
                  </Reveal>
                  <TorSystemSetting
                    checked={cfg.torSystem}
                    restart={restart("torSystem")}
                    onChange={(v) => update({ torSystem: v })}
                  />
                  {/* Where the Tor on this computer is: the node's proxy and
                      Tor control settings, found on the usual ports when empty */}
                  <Reveal show={cfg.torSystem || !torBundled}>
                    <Setting
                      title={t("settings.torSocks")}
                      desc={t("settings.torSocks.desc")}
                      flag="--proxy"
                      restart={restart("proxy")}
                    >
                      <TextInput
                        width="w-44"
                        value={cfg.proxy}
                        placeholder={t("settings.torSocks.placeholder")}
                        onChange={(v) => update({ proxy: v })}
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
                        placeholder={t("settings.torControl.placeholderAuto")}
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
                  </Reveal>
                </Rows>
              </Group>
            )}

            {section === "general" && (
              <>
                <Group title={t("settings.group.language")}>
                  <Rows>
                    <Setting title={t("settings.language.label")} desc={t("settings.language.desc")}>
                      <Select<Lang>
                        className="w-52"
                        aria-label={t("settings.language.label")}
                        value={lang}
                        onChange={setLang}
                        options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
                      />
                    </Setting>
                    <Setting title={t("settings.language.translate")} desc={t("settings.language.translate.desc")}>
                      <button
                        type="button"
                        className="btn btn-tinted btn-sm"
                        onClick={() => openExternal(TRANSLATIONS_URL)}
                      >
                        <ExternalLink className="size-3" />
                        {t("settings.language.translate.cta")}
                      </button>
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
                    {!offline && (
                      <Setting title={t("settings.autoStart")} desc={t("settings.autoStart.desc")}>
                        <Toggle
                          checked={cfg.autoStartNode}
                          onChange={(v) => update({ autoStartNode: v })}
                          label={t("settings.autoStart")}
                        />
                      </Setting>
                    )}
                  </Rows>
                </Group>
                {/* Syncing, notifications of the chain, update checks: none on a signer */}
                {!offline && (
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
                )}
                <Group title={t("settings.group.offline")}>
                  <Rows>
                    <Setting
                      title={t("settings.offlineSigner")}
                      more={t("settings.offlineSigner.more")}
                      desc={t("settings.offlineSigner.desc")}
                    >
                      <Toggle
                        checked={cfg.offlineSigner}
                        // A signer never starts its node; turned back off unsaved, the node's switch is as it was
                        onChange={(v) => update({ offlineSigner: v, autoStartNode: v ? false : orig.autoStartNode })}
                        label={t("settings.offlineSigner")}
                      />
                    </Setting>
                    <Reveal show={cfg.offlineSigner}>
                      <Setting title={t("settings.feeCap")} desc={t("settings.feeCap.desc")}>
                        <FeeCapInput value={cfg.offlineFeeCapWei} onChange={(v) => update({ offlineFeeCapWei: v })} />
                      </Setting>
                    </Reveal>
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
                  <Setting title={t("settings.avatars")} desc={t("settings.avatars.desc")}>
                    <AvatarPreview style={cfg.avatarStyle === "blockies" ? "blockies" : "jazzicon"} />
                    <Segmented
                      value={cfg.avatarStyle === "blockies" ? "blockies" : "jazzicon"}
                      onChange={(v) => instant({ avatarStyle: v })}
                      options={[
                        { value: "jazzicon", label: "Jazzicon" },
                        { value: "blockies", label: "Blockies" },
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
                {import.meta.env.DEV && (
                  <Group title={t("settings.group.devChain")} desc={t("settings.devChain.notice")}>
                    <Rows>
                      <Setting
                        title={t("settings.devChain")}
                        flag="--dev"
                        desc={t("settings.devChain.desc")}
                        restart={restart("devChain")}
                      >
                        <Toggle
                          checked={cfg.devChain}
                          onChange={(v) => update({ devChain: v })}
                          label={t("settings.devChain")}
                        />
                      </Setting>
                      <Reveal show={cfg.devChain}>
                        <Setting
                          title={t("settings.devFund")}
                          desc={t("settings.devFund.desc")}
                          restart={restart("devFundAddress")}
                        >
                          <TextInput
                            width="w-96"
                            value={cfg.devFundAddress}
                            placeholder="0x…"
                            onChange={(v) => update({ devFundAddress: v.trim() })}
                          />
                        </Setting>
                      </Reveal>
                      <DevHold />
                    </Rows>
                  </Group>
                )}
                {nodeStorage(t("settings.group.storage"))}

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
                  </Rows>
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
                        <NumberInput
                          width="w-24"
                          value={cfg[key]}
                          unit="MB"
                          onChange={(v) => update({ [key]: v ?? 0 })}
                        />
                      </Setting>
                    ))}
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
                      <Setting
                        title={t("settings.fdLimit")}
                        desc={t("settings.fdLimit.desc")}
                        restart={restart("fdLimit")}
                      >
                        <NumberInput
                          optional
                          value={cfg.fdLimit || null}
                          placeholder={t("settings.default.system")}
                          onChange={(v) => update({ fdLimit: v ?? 0 })}
                        />
                      </Setting>
                    </Advanced>
                  </Rows>
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
                        <WeiInput
                          value={cfg.gpoIgnorePrice}
                          placeholder="2"
                          onChange={(v) => update({ gpoIgnorePrice: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Rows>
                </Group>

                <Group title={t("settings.group.txpool")} desc={t("settings.txpool.desc")}>
                  <Rows>
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
                          <NumberInput
                            optional
                            value={cfg[key]}
                            placeholder={def}
                            onChange={(v) => update({ [key]: v })}
                          />
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
                  </Rows>
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
                    <Setting
                      title={t("settings.maxPeers")}
                      desc={t("settings.maxPeers.desc")}
                      restart={restart("maxPeers")}
                    >
                      <NumberInput
                        width="w-24"
                        min={1}
                        value={cfg.maxPeers}
                        onChange={(v) => update({ maxPeers: v ?? 0 })}
                      />
                    </Setting>
                    <Setting
                      title={t("settings.nodeName")}
                      desc={t("settings.nodeName.desc")}
                      restart={restart("nodeName")}
                    >
                      <TextInput
                        mono={false}
                        value={cfg.nodeName}
                        placeholder={t("settings.optional")}
                        onChange={(v) => update({ nodeName: v })}
                      />
                    </Setting>
                    <Advanced id="connections" changed={countSet([cfg.natMode, cfg.maxPendingPeers])}>
                      <Setting
                        title={t("settings.nat")}
                        more={t("settings.nat.more")}
                        flag="--nat"
                        desc={t("settings.nat.desc")}
                        restart={restart("natMode", "externalIp")}
                      >
                        <Select<GUIConfig["natMode"]>
                          className="w-48"
                          aria-label={t("settings.nat")}
                          disabled={!inbound}
                          value={cfg.natMode}
                          onChange={(natMode) => update({ natMode })}
                          options={[
                            { value: "", label: t("settings.nat.any") },
                            { value: "upnp", label: "UPnP" },
                            { value: "pmp", label: "NAT-PMP" },
                            { value: "extip", label: t("settings.nat.extip") },
                          ]}
                        />
                      </Setting>
                      <Reveal show={inbound && cfg.natMode === "extip"}>
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
                      </Reveal>
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
                  </Rows>
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
                  </Rows>
                </Group>

                <Group title={t("settings.group.privacy")} desc={t("settings.privacy.desc")}>
                  {/* Between the group's name and its panel, by the group's gap (gap-2.5) */}
                  <Fold show={torSets} gap={10}>
                    <Notice
                      tone="info"
                      action={
                        <button type="button" className="btn btn-secondary" onClick={() => setSection("privacy")}>
                          {t("settings.section.privacy")}
                        </button>
                      }
                    >
                      {t("settings.privacy.torOn")}
                    </Notice>
                  </Fold>
                  <Rows>
                    {/* While Tor is on, the app's own Tor sets the proxy and
                        the control port, the one on this computer may take them */}
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
                        disabled={torSets}
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
                    <Advanced
                      id="privacy"
                      changed={countSet([
                        cfg.onionProxy,
                        cfg.onlyNet,
                        cfg.proxyNoRandomize,
                        cfg.torControl,
                        cfg.torPassword,
                      ])}
                    >
                      <Setting
                        title={t("settings.onlyNet")}
                        more={t("settings.onlyNet.more")}
                        flag="--onlynet"
                        desc={t("settings.onlyNet.desc")}
                        restart={restart("onlyNet")}
                      >
                        <NetworkPicker
                          value={torSets && cfg.torOnionOnly ? ["onion"] : (cfg.onlyNet ?? [])}
                          disabled={torSets && cfg.torOnionOnly}
                          onChange={(v) => update({ onlyNet: v.length ? v : null })}
                        />
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
                          disabled={torSets}
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
                          disabled={torSets}
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
                          disabled={torSets}
                          onChange={(v) => update({ torPassword: v })}
                        />
                      </Setting>
                    </Advanced>
                  </Rows>
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

            {section === "assistants" && <AssistantsOverview cfg={cfg} update={update} />}
            {section === "permissions" && <AssistantsPermissions cfg={cfg} update={update} />}

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
                    <Reveal show={cfg.httpRpcEnabled}>
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
                    </Reveal>
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
                      <Setting
                        title={t("settings.rpc.apis")}
                        desc={t("settings.rpc.apis.desc")}
                        restart={restart("httpApis")}
                      >
                        <ListInput
                          value={cfg.httpApis}
                          placeholder="net, web3, eth, debug"
                          onChange={(v) => update({ httpApis: v })}
                        />
                      </Setting>
                      <Setting
                        title={t("settings.rpc.cors")}
                        desc={t("settings.rpc.cors.desc")}
                        restart={restart("httpCors")}
                      >
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
                  </Rows>
                  {/* The group's last part, under its panel by the group's gap (gap-2.5) */}
                  <Fold show={!LOOPBACK.has(cfg.httpHost) && cfg.httpRpcEnabled} gap={10} at="above">
                    <Notice tone="warn">{t("settings.rpc.exposed")}</Notice>
                  </Fold>
                </Group>

                <Group title={t("settings.group.ws")}>
                  <Rows>
                    <Setting title={t("settings.ws")} desc={t("settings.ws.desc")} restart={restart("wsEnabled")}>
                      <Toggle
                        checked={cfg.wsEnabled}
                        onChange={(v) => update({ wsEnabled: v })}
                        label={t("settings.ws")}
                      />
                    </Setting>
                    <Reveal show={cfg.wsEnabled}>
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
                    </Reveal>
                  </Rows>
                </Group>

                <Group title={t("settings.group.otherApis")}>
                  <Rows>
                    <Setting
                      title={t("settings.graphql")}
                      desc={t("settings.graphql.desc")}
                      restart={restart("graphql")}
                    >
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
                  <Rows>
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
                  </Rows>
                </Group>
              </>
            )}

            {section === "diagnostics" && (
              <>
                <Group title={t("settings.group.logging")}>
                  <Rows>
                    <Setting title={t("settings.logLevel")} desc={t("settings.logLevel.desc")}>
                      <Select<number>
                        className="w-40"
                        aria-label={t("settings.logLevel")}
                        value={cfg.logLevel || 3}
                        onChange={(v) => instant({ logLevel: v === 3 ? 0 : v })}
                        options={[1, 2, 3, 4, 5].map((l) => ({ value: l, label: t(`settings.logLevel.${l}`) }))}
                      />
                    </Setting>
                    <Setting title={t("settings.clearLogs")} desc={t("settings.clearLogs.desc")}>
                      <Toggle
                        checked={cfg.clearLogsOnStartup}
                        onChange={(v) => instant({ clearLogsOnStartup: v })}
                        label={t("settings.clearLogs")}
                      />
                    </Setting>
                  </Rows>
                </Group>
                {!offline && (
                  <Group title={t("settings.group.metrics")}>
                    <Rows>
                      <Setting
                        title={t("settings.metrics")}
                        more={t("settings.metrics.more")}
                        flag="--metrics"
                        desc={t("settings.metrics.desc")}
                        restart={restart("metrics")}
                      >
                        <Toggle
                          checked={cfg.metrics}
                          onChange={(v) => update({ metrics: v })}
                          label={t("settings.metrics")}
                        />
                      </Setting>
                      <Reveal show={cfg.metrics}>
                        <Advanced
                          id="metrics"
                          changed={countSet([cfg.metricsExpensive, cfg.metricsAddr, cfg.metricsPort])}
                        >
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
                      </Reveal>
                    </Rows>
                  </Group>
                )}
                <Group title={t("settings.group.logs")} desc={t("settings.diagnostics.desc")}>
                  <LogsPanel />
                </Group>
              </>
            )}
            {section === "about" && <About />}
          </div>
        </motion.div>

        <SaveBar
          dirty={dirty}
          saved={saved}
          dirtyNeedsRestart={dirtyNeedsRestart || dirtyNeedsAppRestart}
          restartPending={appRestartPending ? "app" : restartPending ? "node" : null}
          restarting={restarting}
          restartWaiting={appRestartPending ? null : torWaiting}
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

/**
 * FeeCapInput edits the offline signer's fee cap in LAX, stored as decimal
 * wei ("" is the default, 1 LAX); a value that isn't a positive amount
 * is held back until it is.
 */
function FeeCapInput({ value, onChange }: { value: string; onChange: (wei: string) => void }) {
  const t = useT();
  const [text, setText] = useState(value ? formatUnits(value, 18) : "1");
  const wei = parseUnits(text, 18);
  const bad = wei === null || wei <= 0n;
  return (
    <span className="flex items-center gap-2">
      <span className="relative w-36">
        <input
          className={`input pr-12 tabular-nums ${bad ? "border-critical" : ""}`}
          inputMode="decimal"
          value={text}
          aria-label={t("settings.feeCap")}
          aria-invalid={bad}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            setText(v);
            const w = parseUnits(v, 18);
            if (w !== null && w > 0n) onChange(w === 10n ** 18n ? "" : w.toString());
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">LAX</span>
      </span>
    </span>
  );
}

/** WeiInput edits a whole number of wei as text: amounts outgrow a JS number. */
function WeiInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
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
/** TorStatusRow says how Tor is doing while its switch is on, and the node's onion address once it has one. */
function TorStatusRow({ on }: { on: boolean }) {
  const st = useTorStatus();
  return <Reveal show={on && !!st?.enabled}>{st && <TorStatusContent st={st} />}</Reveal>;
}

function TorStatusContent({ st }: { st: TorStatus }) {
  const t = useT();
  const desc =
    st.state === "starting"
      ? `${t("tor.state.starting", { n: st.progress })}${st.summary ? ` · ${st.summary}` : ""}`
      : st.state === "ready"
        ? t(st.system ? "tor.state.readySystem" : "tor.state.ready", { socks: st.socks })
        : st.state === "failed"
          ? `${t(`tor.reason.${st.reason || "exited"}`)}${st.error ? ` (${st.error})` : ""}`
          : "";
  // What shows at the row's end, swapped in place as Tor goes along, as the save bar swaps its message
  const shown = st.state === "starting" ? "progress" : st.onion ? "onion" : st.state;
  return (
    <Setting title={t("settings.torStatus")} desc={desc}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={shown}
          className="flex min-w-0 items-center gap-1"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: FADE_IN }}
          exit={{ opacity: 0, y: -10, transition: FADE_OUT }}
        >
          {shown === "progress" ? (
            <Meter value={st.progress / 100} live className="w-32" label={desc} />
          ) : shown === "onion" ? (
            <>
              <Tooltip content={t("tor.onion")}>
                <span className="max-w-56 truncate font-mono text-sm">{st.onion}</span>
              </Tooltip>
              <CopyButton value={st.onion} />
            </>
          ) : (
            <Indicator
              grade={st.state === "ready" ? "good" : st.state === "failed" ? "critical" : "off"}
              ping={st.state === "ready"}
              label={desc}
            />
          )}
        </motion.span>
      </AnimatePresence>
    </Setting>
  );
}

/** TorSystemSetting picks the Tor on this computer over the app's own; in a build with none of its own, it's the only one. */
function TorSystemSetting({
  checked,
  restart,
  onChange,
}: {
  checked: boolean;
  restart: boolean | "app";
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  const st = useTorStatus();
  const bundled = st?.bundled ?? true;
  return (
    <Setting
      title={t("settings.torSystem")}
      more={t("settings.torSystem.more")}
      desc={bundled ? t("settings.torSystem.desc") : t("settings.torSystem.only")}
      restart={restart}
    >
      <Toggle checked={checked || !bundled} disabled={!bundled} onChange={onChange} label={t("settings.torSystem")} />
    </Setting>
  );
}

function NetworkPicker({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  const t = useT();
  return (
    <div className="flex gap-1">
      {(["ipv4", "ipv6", "onion"] as const).map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
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
  const offline = useOfflineMode();
  const tor = useTorStatus();
  const [appVersion, setAppVersion] = useState("");
  const [client, setClient] = useState<{ release: string; meta: string; commit: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    api
      .version()
      .then(setAppVersion)
      .catch(() => {});
    // The client's version parts are there whether or not the node runs
    api
      .nodeDetails()
      .then((d) => setClient({ release: d.daemonRelease, meta: d.daemonMeta, commit: d.daemonCommit }))
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

  // The backend answers "Parallax Wallet 0.2.3": the name, then the version
  const m = appVersion.match(/^(.*?)\s+v?(\d[\w.+-]*)$/);
  const appName = m ? m[1] : appVersion || "Parallax Wallet";
  const appNumber = m ? m[2] : "";

  return (
    <div className="flex flex-col gap-7">
      {/* The app, as an About window shows it */}
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <LogoMark size={80} />
        <div className="flex flex-col gap-1">
          <h3 className="text-2xl font-semibold tracking-tight">{appName}</h3>
          {appNumber && (
            <span className="selectable text-muted-foreground">
              {t("settings.about.version", { version: appNumber })}
            </span>
          )}
        </div>
      </div>

      <Rows>
        <Row
          title={t("details.daemonVersion")}
          desc={
            client && (client.meta || client.commit) ? (
              <span className="flex items-center gap-1.5">
                {client.meta}
                {client.commit && (
                  <>
                    {client.meta && <span>·</span>}
                    <Tooltip content={client.commit} mono>
                      <span className="selectable font-mono">{client.commit.slice(0, 8)}</span>
                    </Tooltip>
                  </>
                )}
              </span>
            ) : undefined
          }
        >
          <span className="selectable font-medium tabular-nums">{client ? `v${client.release}` : "—"}</span>
        </Row>
        {/* The Tor the app's traffic goes through when Tor is on: the one it
            ships, by its version, or the one on this computer, whose isn't
            known. An offline signer sends nothing, Tor or not */}
        {!offline && tor && (
          <Row
            title={t("settings.about.tor")}
            desc={tor.bundled && !tor.system && tor.version ? t("settings.about.torBundled") : undefined}
          >
            {tor.bundled && !tor.system && tor.version ? (
              <span className="selectable font-medium tabular-nums">{tor.version}</span>
            ) : (
              <span className="text-muted-foreground">{t("settings.about.torSystem")}</span>
            )}
          </Row>
        )}
        {/* What each version brought, as the update's dialog shows it; read
            from GitHub, which an offline signer never reaches */}
        {!offline && (
          <Row title={t("settings.about.notes")} desc={t("settings.about.notes.desc")}>
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => setNotesOpen(true)}>
              {t("settings.about.notes.show")}
            </button>
          </Row>
        )}
        <Row
          title={t("settings.about.updates")}
          desc={offline ? t("settings.about.offlineUpdates") : (result ?? undefined)}
        >
          {offline ? null : info ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
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
              {updating && <Loader2 className="size-3 animate-spin" />}
              {updating ? t("settings.about.updating") : t("settings.about.updateNow")}
            </button>
          ) : (
            <button type="button" className="btn btn-tinted btn-sm" disabled={checking} onClick={check}>
              <RefreshCw className={`size-3 ${checking ? "animate-spin" : ""}`} />
              {checking ? t("settings.about.checking") : t("settings.about.check")}
            </button>
          )}
        </Row>
      </Rows>
      <ReleaseNotesModal open={notesOpen} onClose={() => setNotesOpen(false)} version={appNumber} />

      <Rows>
        {ABOUT_LINKS.map((l) => (
          <Row key={l.url} title={t(l.title)} desc={l.url.replace(/^https:\/\//, "")}>
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => openExternal(l.url)}>
              <ExternalLink className="size-3" />
              {t("settings.about.open")}
            </button>
          </Row>
        ))}
      </Rows>

      {/* Where a problem or a wish goes: the project's issue forms on GitHub
          (.github/ISSUE_TEMPLATE), a problem's with this app's version and
          system filled in */}
      <Rows>
        <Row title={t("settings.about.bug")} desc={t("settings.about.bug.desc")}>
          <button
            type="button"
            className="btn btn-tinted btn-sm"
            onClick={() => openExternal(issueURL("bug_report.yml", { version: appNumber, os: SYSTEM }))}
          >
            <ExternalLink className="size-3" />
            {t("settings.about.bug.open")}
          </button>
        </Row>
        <Row title={t("settings.about.feature")} desc={t("settings.about.feature.desc")}>
          <button
            type="button"
            className="btn btn-tinted btn-sm"
            onClick={() => openExternal(issueURL("feature_request.yml"))}
          >
            <ExternalLink className="size-3" />
            {t("settings.about.feature.open")}
          </button>
        </Row>
      </Rows>
    </div>
  );
}

// Where the app's strings live, for anyone who'd fix one or add a language
const TRANSLATIONS_URL = "https://github.com/ParallaxProtocol/parallax-gui/tree/main/frontend/src/i18n";

/**
 * issueURL opens one of the repository's issue forms, its fields filled in
 * by id (the form's own ids, .github/ISSUE_TEMPLATE); empty ones are left out.
 */
function issueURL(template: string, fields: Record<string, string> = {}) {
  const q = new URLSearchParams({ template });
  for (const [k, v] of Object.entries(fields)) if (v) q.set(k, v);
  return `https://github.com/ParallaxProtocol/parallax-gui/issues/new?${q}`;
}

// The computer, as the problem form's "Your computer" names it
const SYSTEM =
  ({ win32: "Windows", darwin: "macOS", linux: "Linux" } as Record<string, string>)[window.parallax?.platform ?? ""] ??
  "";

// The project's own pages, opened in the user's browser
const ABOUT_LINKS = [
  { title: "settings.about.website", url: "https://parallaxprotocol.org" },
  { title: "settings.about.status", url: "https://status.parallaxprotocol.org" },
] as const;

function SaveBar({
  dirty,
  saved,
  dirtyNeedsRestart,
  restartPending,
  restarting,
  restartWaiting,
  onSave,
  onDiscard,
  onRestart,
}: {
  dirty: boolean;
  saved: boolean;
  dirtyNeedsRestart: boolean;
  restartPending: "node" | "app" | null;
  restarting: boolean;
  /** Why the node can't restart yet (Tor still connecting), shown on its button, disabled. */
  restartWaiting: string | null;
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
          className="shrink-0 overflow-hidden border-t border-border bg-popover/60 backdrop-blur-xl"
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
                    {dirtyNeedsRestart && (
                      <span className="ml-2 text-sm text-warn-ink">{t("settings.save.needsRestart")}</span>
                    )}
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
                    {restartPending === "app"
                      ? t("settings.save.appRestartRequired")
                      : t("settings.save.restartRequired")}
                  </span>
                  <button
                    type="button"
                    onClick={onRestart}
                    disabled={restarting || !!restartWaiting}
                    className="btn btn-primary"
                  >
                    {(restarting || restartWaiting) && <Loader2 className="size-3.5 animate-spin" />}
                    {restarting
                      ? t("settings.save.restarting")
                      : restartWaiting
                        ? restartWaiting
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

/** The sections, grouped under headings in the list, in SETTINGS_SECTIONS' order. */
/** The sections about the node, which an offline signer never runs. */
const NODE_SECTIONS = new Set<SettingsSection>(["node", "network", "rpc", "assistants", "permissions"]);

const NAV_GROUPS: { title: string; sections: SettingsSection[] }[] = [
  { title: "settings.navGroup.app", sections: ["general", "appearance", "privacy", "storage"] },
  { title: "nav.wallet", sections: ["accounts", "security"] },
  { title: "nav.node", sections: ["node", "network", "rpc"] },
  { title: "settings.navGroup.assistants", sections: ["assistants", "permissions"] },
  { title: "settings.navGroup.support", sections: ["diagnostics", "about"] },
];

/** Each section's icon and colour, as System Settings gives its panes. */
const SECTION_LOOK: Record<SettingsSection, { icon: LucideIcon; color: string }> = {
  accounts: { icon: KeyRound, color: TILE.indigo },
  security: { icon: Lock, color: TILE.blue },
  storage: { icon: HardDrive, color: TILE.gray },
  general: { icon: Settings2, color: TILE.gray },
  appearance: { icon: Palette, color: TILE.blue },
  privacy: { icon: OnionSymbol, color: TILE.purple },
  node: { icon: Server, color: TILE.purple },
  network: { icon: Globe, color: TILE.green },
  rpc: { icon: Plug, color: TILE.orange },
  assistants: { icon: SparklesSymbol, color: TILE.indigo },
  permissions: { icon: ShieldCheck, color: TILE.green },
  diagnostics: { icon: Activity, color: TILE.pink },
  about: { icon: Info, color: TILE.graphite },
};

/** SectionTile is a section's icon on its coloured tile. */
function SectionTile({ id, small, large }: { id: SettingsSection; small?: boolean; large?: boolean }) {
  const { icon, color } = SECTION_LOOK[id];
  return <IconTile icon={icon} color={color} small={small} large={large} />;
}

/** An address to preview avatars with while the wallet has no account: EIP-55's example. */
const SAMPLE_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/** AvatarPreview pictures the selected account (or a sample) in a style, beside its choice. */
function AvatarPreview({ style }: { style: AvatarStyle }) {
  const { account } = useWallet();
  return <AddressAvatar address={account?.address ?? SAMPLE_ADDRESS} size={24} style={style} className="mr-2" />;
}

/**
 * DevHold stops the running development chain sealing a block for each
 * transaction, so what is sent waits in the pool as it would between
 * mainnet blocks: to see it pending, speed it up or cancel it. Letting go
 * seals what waits. Not kept across restarts.
 */
function DevHold() {
  const t = useT();
  const node = useNode();
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  if (!node?.running || !node.devChain) return null;
  return (
    <Setting title={t("settings.devHold")} desc={error ?? t("settings.devHold.desc")}>
      <Toggle
        checked={node.devHeld}
        onChange={(v) =>
          api
            .devSetHold(v)
            .then(() => {
              setError(null);
              refresh();
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        }
        label={t("settings.devHold")}
      />
    </Setting>
  );
}
