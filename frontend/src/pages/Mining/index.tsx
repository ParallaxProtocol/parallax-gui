import { useEffect, useState } from "react";
import { Check, Cpu, Loader2, Network, Pencil, Play, Plus, Zap } from "lucide-react";
import { api, DeviceInfo, GUIConfig, MiningMode, PoolInfo } from "../../lib/api";
import { useMiner, useNode, useRefresh } from "../../lib/live";
import { useT } from "../../i18n";
import { Panel, Rows, Section } from "../../components/ui/Panel";
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
  const node = useNode();
  const { status: miner, hashrate } = useMiner();
  const refresh = useRefresh();
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
    <div className="flex flex-col gap-6 p-5">
      {(err || miner.error) && <Notice tone="critical">{err || miner.error}</Notice>}

      {running ? (
        <Live status={miner} history={hashrate} onStop={stop} />
      ) : (
        <>
          <Section title={t("mining.section.mode")}>
            <div role="radiogroup" aria-label={t("mining.section.mode")} className="grid grid-cols-3 gap-3">
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
                    className={`flex items-start gap-3 rounded-lg border bg-surface p-3 text-left shadow-[var(--shadow-panel)] transition-colors disabled:opacity-40 ${
                      here ? "border-brand-mark ring-1 ring-brand-mark" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <Icon className={`mt-px size-4 shrink-0 ${here ? "text-brand" : "text-muted-foreground"}`} />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{t(`mining.mode.${m}`)}</span>
                      <span className="text-sm text-muted-foreground">{t(`mining.mode.${m}.desc`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="px-1 text-sm text-muted-foreground">
              {t("mining.intro")} {isMac && t("mining.mac.help")}
            </p>
          </Section>

          <Section title={t("mining.config")}>
            {gpuMode && hashwarpFound === null ? (
              <Panel className="grid place-items-center p-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </Panel>
            ) : needsHashwarp ? (
              <HashwarpSetup onInstalled={recheckHashwarp} avBlocked={avBlocked} setAvBlocked={setAvBlocked} />
            ) : (
              <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
                <Rows>
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
                        <div className="flex gap-1.5">
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
                              className="btn btn-secondary btn-icon"
                              title={t("mining.edit")}
                              aria-label={t("mining.edit")}
                              onClick={() => setPoolDrawer({ open: true, editing: selectedPool })}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            title={t("mining.pool.add")}
                            aria-label={t("mining.pool.add")}
                            onClick={() => setPoolDrawer({ open: true, editing: null })}
                          >
                            <Plus className="size-3.5" />
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
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <span>{t("mining.gpuDevices")}</span>
                      {gpus.length === 0 ? (
                        <Notice tone="info">{t("mining.gpu.none")}</Notice>
                      ) : (
                        <div className="flex flex-col">
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
                                className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                              >
                                <span
                                  className={`grid size-4 shrink-0 place-items-center rounded-[4px] ${
                                    on ? "bg-brand-fill text-brand-foreground" : "border border-border-strong bg-field"
                                  }`}
                                >
                                  {on && <Check className="size-3" strokeWidth={3} />}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  GPU {g.index}: {g.name}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                  {g.memory}
                                  {g.cuda && " · CUDA"}
                                  {g.openCl && " · OpenCL"}
                                </span>
                              </button>
                            );
                          })}
                          {devices.length === 0 && <p className="mt-1 text-sm text-muted-foreground">{t("mining.gpu.allDefault")}</p>}
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
                </Rows>

                <Panel className="flex flex-col gap-3 p-4">
                  <span className="font-medium">{t("mining.checklist")}</span>
                  <ul className="flex flex-col gap-2.5">
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
                  <button type="button" className="btn btn-primary btn-lg mt-2 w-full" onClick={start} disabled={!ready || starting}>
                    {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5 fill-current" />}
                    {starting ? t("mining.starting") : t(`mining.start.${mode}`)}
                  </button>
                </Panel>
              </div>
            )}
          </Section>
        </>
      )}

      <PoolDrawer
        open={poolDrawer.open}
        editing={poolDrawer.editing}
        onClose={() => setPoolDrawer({ open: false, editing: null })}
        onSave={savePool}
        onRemove={removePool}
      />
    </div>
  );
}

/** One line of the start checklist: ticked once its condition holds. */
function Check_({ ok, label, action }: { ok: boolean; label: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={`grid size-4 shrink-0 place-items-center rounded-full ${
          ok ? "bg-brand-fill text-brand-foreground" : "border border-border-strong"
        }`}
      >
        {ok && <Check className="size-2.5" strokeWidth={3.5} />}
      </span>
      <span className={`flex-1 ${ok ? "" : "text-muted-foreground"}`}>{label}</span>
      {action}
    </li>
  );
}
