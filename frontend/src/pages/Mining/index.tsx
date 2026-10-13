import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cpu, Loader2, Network, Pencil, Play, Plus, Zap } from "lucide-react";
import { api, DeviceInfo, GUIConfig, MiningMode, PoolInfo } from "../../lib/api";
import { useLive } from "../../lib/live";
import { SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { PageStagger } from "../../components/PageStagger";
import { Indicator } from "../../components/ui/Indicator";
import { Label, Plate } from "../../components/ui/Plate";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Notice } from "../../components/ui/bits";
import { isAddress } from "../../lib/format";
import HashwarpSetup from "./Hashwarp";
import Live from "./Live";
import PoolDrawer, { FormRow } from "./PoolDrawer";

type Mode = Exclude<MiningMode, "off">;

const isMac = navigator.userAgent.includes("Mac");
const isWindows = navigator.userAgent.includes("Windows");
const MODES: { mode: Mode; icon: typeof Cpu; gpu: boolean }[] = [
  { mode: "pool", icon: Network, gpu: true },
  { mode: "sologpu", icon: Zap, gpu: true },
  { mode: "solo", icon: Cpu, gpu: false },
];

/** Saves part of the config over a fresh read, so changes made on other pages since are kept. */
async function persist(patch: Partial<GUIConfig>) {
  const c = await api.getConfig();
  await api.updateConfig({ ...c, ...patch });
}

export default function Mining() {
  const t = useT();
  const { node, miner, hashrate, refresh } = useLive();
  const [mode, setMode] = useState<Mode>(isMac ? "solo" : "pool");
  const [gpus, setGpus] = useState<DeviceInfo[]>([]);
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [hashwarpFound, setHashwarpFound] = useState<boolean | null>(null);
  const [avBlocked, setAvBlocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [wallet, setWallet] = useState("");
  const [worker, setWorker] = useState("");
  const [poolUrl, setPoolUrl] = useState("");
  const [threads, setThreads] = useState(Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)) || 2);
  const [devices, setDevices] = useState<number[]>([]);
  const [poolDrawer, setPoolDrawer] = useState<{ open: boolean; editing: PoolInfo | null }>({ open: false, editing: null });

  useEffect(() => {
    api.hashwarpInstalled().then(setHashwarpFound).catch(() => setHashwarpFound(false));
    Promise.all([api.getConfig(), api.defaultPools().catch(() => [] as PoolInfo[])]).then(([c, dp]) => {
      setWallet(c.miningWallet || "");
      setWorker(c.miningWorker || "");
      if (c.miningThreads > 0) setThreads(c.miningThreads);
      if (c.miningDevices?.length) setDevices(c.miningDevices);
      setPools([...dp, ...(c.customPools || [])]);
      setPoolUrl(c.miningPool || dp[0]?.url || "");
    });
    api.detectGPUs().then(setGpus).catch(() => setGpus([]));
  }, []);

  const recheckHashwarp = () => {
    setAvBlocked(false);
    setHashwarpFound(null);
    api
      .hashwarpInstalled()
      .then((found) => {
        setHashwarpFound(found);
        if (found) api.detectGPUs().then(setGpus).catch(() => setGpus([]));
      })
      .catch(() => setHashwarpFound(false));
  };

  const gpuMode = mode === "pool" || mode === "sologpu";
  const needsNode = mode !== "pool";
  const nodeSynced = !!node?.running && !node.syncing;
  const needsHashwarp = gpuMode && (hashwarpFound === false || avBlocked);
  const maxThreads = navigator.hardwareConcurrency || 16;

  const ready =
    isAddress(wallet) && (mode !== "pool" || !!poolUrl) && (!needsNode || nodeSynced) && !needsHashwarp;

  const start = async () => {
    setErr(null);
    setStarting(true);
    try {
      await persist({
        miningWallet: wallet.trim(),
        miningWorker: worker,
        miningPool: poolUrl,
        miningThreads: threads,
        miningDevices: devices,
      });
      await api.startMining(mode);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // A missing hashwarp on Windows was most likely deleted by Defender
      if (isWindows && msg.toLowerCase().includes("hashwarp") && msg.toLowerCase().includes("not found")) {
        setHashwarpFound(false);
        setAvBlocked(true);
      } else {
        setErr(msg);
      }
    } finally {
      setStarting(false);
      refresh();
    }
  };

  const stop = async () => {
    setErr(null);
    try {
      await api.stopMining();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      refresh();
    }
  };

  const savePool = (pool: PoolInfo) => {
    const editingUrl = poolDrawer.editing?.url;
    const next = editingUrl ? pools.map((p) => (!p.builtin && p.url === editingUrl ? pool : p)) : [...pools, pool];
    setPools(next);
    setPoolUrl(pool.url);
    setPoolDrawer({ open: false, editing: null });
    persist({ customPools: next.filter((p) => !p.builtin), miningPool: pool.url }).catch(() => {});
  };

  const removePool = (url: string) => {
    const next = pools.filter((p) => p.url !== url);
    const selected = poolUrl === url ? next[0]?.url || "" : poolUrl;
    setPools(next);
    setPoolUrl(selected);
    setPoolDrawer({ open: false, editing: null });
    persist({ customPools: next.filter((p) => !p.builtin), miningPool: selected }).catch(() => {});
  };

  const selectedPool = pools.find((p) => p.url === poolUrl);
  const running = !!miner?.running;

  // Until the first status arrives, neither view is known to be right:
  // showing setup would flash it before a running miner's live view
  if (!miner) return null;

  return (
    <PageStagger className="flex flex-col gap-10">
      <AnimatePresence initial={false}>
        {(err || (miner?.error && !err)) && (
          <motion.div key="err" exit={{ opacity: 0, height: 0 }}>
            <Notice tone="critical">{err || miner?.error}</Notice>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {running && miner ? (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
          >
            <Live status={miner} history={hashrate} onStop={stop} />
          </motion.div>
        ) : (
          <motion.div
            key="setup"
            className="flex flex-col gap-10"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
          >
            <div className="flex flex-col gap-4">
              <SectionHeader index={1} title={t("mining.section.mode")} />
              <p className="max-w-3xl text-sm text-muted-foreground">{t("mining.intro")}</p>
              <div role="radiogroup" className="grid grid-cols-3 gap-4">
                {MODES.map(({ mode: m, icon: Icon, gpu }) => {
                  const disabled = isMac && gpu;
                  const here = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={here}
                      disabled={disabled}
                      title={disabled ? t("mining.mac.disabled") : undefined}
                      onClick={() => setMode(m)}
                      className={`group/plate relative flex flex-col items-start gap-3 rounded-md border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        here ? "border-brand/60 bg-surface-elevated" : "border-border bg-surface-elevated/60 hover:border-foreground/20"
                      }`}
                    >
                      <span aria-hidden className="plate-brackets" />
                      {here && (
                        <motion.span
                          layoutId="mode-current"
                          transition={SPRING}
                          className="brand-gradient-mark absolute inset-x-0 -top-px h-0.5 rounded-t-md"
                        />
                      )}
                      <span
                        className={`grid size-9 place-items-center rounded-md border transition-colors ${
                          here ? "brand-gradient border-transparent text-brand-foreground" : "border-border-strong text-muted-foreground"
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="text-sm font-medium">{t(`mining.mode.${m}`)}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">{t(`mining.mode.${m}.desc`)}</span>
                    </button>
                  );
                })}
              </div>
              {isMac && <p className="text-xs text-muted-foreground">{t("mining.mac.help")}</p>}
            </div>

            <div className="flex flex-col gap-4">
              <SectionHeader index={2} title={t("mining.config")} />
              {gpuMode && hashwarpFound === null ? (
                <Plate className="grid place-items-center p-10">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </Plate>
              ) : needsHashwarp ? (
                <HashwarpSetup onInstalled={recheckHashwarp} avBlocked={avBlocked} setAvBlocked={setAvBlocked} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                  <Plate className="flex flex-col gap-5 p-6">
                    <FormRow
                      label={t("mining.wallet")}
                      hint={wallet && !isAddress(wallet) ? <span className="text-critical-ink">{t("wallet.watch.invalid")}</span> : undefined}
                    >
                      <input
                        className="input font-mono"
                        placeholder={t("mining.ph.wallet")}
                        value={wallet}
                        onChange={(e) => setWallet(e.target.value)}
                        spellCheck={false}
                      />
                    </FormRow>

                    {mode === "pool" && (
                      <>
                        <FormRow label={t("mining.pool")}>
                          <div className="flex gap-2">
                            <select className="input" value={poolUrl} onChange={(e) => setPoolUrl(e.target.value)}>
                              {pools.map((p) => (
                                <option key={p.url} value={p.url}>
                                  {p.name}
                                  {p.region ? ` (${p.region})` : ""}
                                </option>
                              ))}
                            </select>
                            {selectedPool && !selectedPool.builtin && (
                              <button
                                type="button"
                                className="btn btn-secondary px-3"
                                title={t("mining.edit")}
                                aria-label={t("mining.edit")}
                                onClick={(e) => {
                                  e.preventDefault();
                                  setPoolDrawer({ open: true, editing: selectedPool });
                                }}
                              >
                                <Pencil className="size-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary px-3"
                              title={t("mining.pool.add")}
                              aria-label={t("mining.pool.add")}
                              onClick={(e) => {
                                e.preventDefault();
                                setPoolDrawer({ open: true, editing: null });
                              }}
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                        </FormRow>
                        <FormRow label={t("mining.worker")}>
                          <input
                            className="input"
                            placeholder={t("mining.ph.worker")}
                            value={worker}
                            onChange={(e) => setWorker(e.target.value)}
                          />
                        </FormRow>
                      </>
                    )}

                    {gpuMode && (
                      <div className="flex flex-col gap-2">
                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                          {t("mining.gpuDevices")}
                        </span>
                        {gpus.length === 0 ? (
                          <Notice tone="info">{t("mining.gpu.none")}</Notice>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {gpus.map((g) => {
                              const on = devices.length === 0 || devices.includes(g.index);
                              return (
                                <button
                                  key={g.index}
                                  type="button"
                                  role="checkbox"
                                  aria-checked={on}
                                  onClick={() =>
                                    setDevices((prev) => {
                                      // An empty list means all: make it explicit before removing one
                                      const all = prev.length === 0 ? gpus.map((x) => x.index) : prev;
                                      if (!all.includes(g.index)) return [...all, g.index];
                                      const rest = all.filter((d) => d !== g.index);
                                      // An empty list would mean all again: keep at least one
                                      return rest.length > 0 ? rest : all;
                                    })
                                  }
                                  className={`flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors ${
                                    on ? "border-brand/50 bg-brand-muted/30" : "border-border bg-background hover:border-foreground/20"
                                  }`}
                                >
                                  <span
                                    className={`grid size-4 shrink-0 place-items-center rounded-sm border ${
                                      on ? "brand-gradient border-transparent text-brand-foreground" : "border-border-strong"
                                    }`}
                                  >
                                    {on && <Check className="size-3" strokeWidth={3} />}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">
                                      GPU {g.index}: {g.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {g.memory}
                                      {g.cuda && " · CUDA"}
                                      {g.openCl && " · OpenCL"}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                            {devices.length === 0 && <p className="text-xs text-muted-foreground">{t("mining.gpu.allDefault")}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {mode === "solo" && (
                      <FormRow label={t("mining.cpuThreads")} hint={`${threads} / ${maxThreads}`}>
                        <input
                          type="range"
                          className="range"
                          min={1}
                          max={maxThreads}
                          value={threads}
                          onChange={(e) => setThreads(parseInt(e.target.value, 10))}
                        />
                      </FormRow>
                    )}
                  </Plate>

                  <Plate className="flex flex-col gap-4 p-6">
                    <Label>{t("mining.checklist")}</Label>
                    <ul className="flex flex-col gap-3 text-sm">
                      <Check_ ok={isAddress(wallet)} label={t("mining.check.wallet")} />
                      {mode === "pool" && <Check_ ok={!!poolUrl} label={t("mining.check.pool")} />}
                      {gpuMode && <Check_ ok={!!hashwarpFound} label={t("mining.check.hashwarp")} />}
                      {needsNode && (
                        <Check_
                          ok={nodeSynced}
                          label={
                            !node?.running
                              ? t("mining.node.notRunning")
                              : node.syncing
                                ? t("mining.node.syncing")
                                : t("mining.node.ready")
                          }
                          action={
                            !node?.running ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  api
                                    .startNode()
                                    .catch((e: any) => setErr(e?.message || String(e)))
                                    .finally(refresh)
                                }
                              >
                                {t("mining.startNode")}
                              </button>
                            ) : undefined
                          }
                        />
                      )}
                    </ul>
                    <div className="mt-auto pt-2">
                      <button type="button" className="btn btn-primary btn-lg w-full" onClick={start} disabled={!ready || starting}>
                        {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                        {starting ? t("mining.starting") : t(`mining.start.${mode}`)}
                      </button>
                    </div>
                  </Plate>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PoolDrawer
        open={poolDrawer.open}
        editing={poolDrawer.editing}
        onClose={() => setPoolDrawer({ open: false, editing: null })}
        onSave={savePool}
        onRemove={removePool}
      />
    </PageStagger>
  );
}

/** One line of the start checklist: ticked once its condition holds. */
function Check_({ ok, label, action }: { ok: boolean; label: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <motion.span
        initial={false}
        animate={{ scale: ok ? 1 : 0.9 }}
        transition={SPRING}
        className={`grid size-5 shrink-0 place-items-center rounded-full border ${
          ok ? "brand-gradient border-transparent text-brand-foreground" : "border-border-strong"
        }`}
      >
        {ok ? <Check className="size-3" strokeWidth={3} /> : <Indicator grade="off" className="scale-75" />}
      </motion.span>
      <span className={`flex-1 ${ok ? "" : "text-muted-foreground"}`}>{label}</span>
      {action}
    </li>
  );
}
