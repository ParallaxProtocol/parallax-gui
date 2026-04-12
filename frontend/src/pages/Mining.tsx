import { useEffect, useRef, useState } from "react";
import {
  api,
  GUIConfig,
  NodeStatus,
  MinerStatus,
  MiningMode,
  DeviceInfo,
  PoolInfo,
} from "../lib/api";
import { formatHashrate, formatDuration, formatDifficulty } from "../lib/format";
import SectionHeading from "../components/SectionHeading";
import AnimatedNumber from "../components/AnimatedNumber";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import { useT } from "../i18n";

export default function Mining() {
  const t = useT();
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [gpus, setGpus] = useState<DeviceInfo[]>([]);
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const isMac = navigator.userAgent.includes("Mac");
  const [selectedMode, setSelectedMode] = useState<"pool" | "sologpu" | "solo">(isMac ? "solo" : "pool");
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [hashwarpFound, setHashwarpFound] = useState<boolean | null>(null); // null = loading
  const [avBlocked, setAvBlocked] = useState(false); // Windows Defender blocked hashwarp
  const isWindows = navigator.userAgent.includes("Windows");

  // Form state (kept in sync with config)
  const [wallet, setWallet] = useState("");
  const [worker, setWorker] = useState("");
  const [poolUrl, setPoolUrl] = useState("");
  const [threads, setThreads] = useState(
    Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)) || 2,
  );
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [showCustomPool, setShowCustomPool] = useState(false);
  const [editingPoolUrl, setEditingPoolUrl] = useState<string | null>(null); // url of pool being edited, null = adding new
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customRegion, setCustomRegion] = useState("");

  // Load config, pools, GPUs, and check hashwarp on mount
  useEffect(() => {
    api.hashwarpInstalled().then(setHashwarpFound).catch(() => setHashwarpFound(false));
    api.getConfig().then((c) => {
      setCfg(c);
      if (c.miningWallet) setWallet(c.miningWallet);
      if (c.miningWorker) setWorker(c.miningWorker);
      if (c.miningPool) setPoolUrl(c.miningPool);
      if (c.miningThreads > 0) setThreads(c.miningThreads);
      if (c.miningDevices?.length) setSelectedDevices(c.miningDevices);
    });
    api.defaultPools().then((dp) => {
      api.getConfig().then((c) => {
        const custom = c.customPools || [];
        setPools([...dp, ...custom]);
        if (!c.miningPool && dp.length > 0) {
          setPoolUrl(dp[0].url);
        }
      });
    });
    api.detectGPUs().then(setGpus).catch(() => setGpus([]));
  }, []);

  // Poll miner + node status every 2s
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [ms, ns] = await Promise.all([
        api.minerStatus().catch(() => null),
        api.nodeStatus().catch(() => null),
      ]);
      if (!alive) return;
      if (ms) setStatus(ms);
      if (ns) setNodeStatus(ns);
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const isRunning = status?.running ?? false;

  const persistConfig = (patch: Partial<GUIConfig>) => {
    if (!cfg) return;
    const updated = { ...cfg, ...patch };
    setCfg(updated);
    api.updateConfig(updated).catch(() => { });
  };

  const start = async () => {
    setErr(null);
    setStarting(true);
    try {
      // Persist settings before starting
      persistConfig({
        miningWallet: wallet,
        miningWorker: worker,
        miningPool: poolUrl,
        miningThreads: threads,
        miningDevices: selectedDevices,
      });
      await api.startMining(selectedMode as MiningMode);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // If hashwarp is missing on Windows, it was likely deleted by Defender
      if (isWindows && msg.toLowerCase().includes("hashwarp") && msg.toLowerCase().includes("not found")) {
        setHashwarpFound(false);
        setAvBlocked(true);
      } else {
        setErr(msg);
      }
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setErr(null);
    setStopping(true);
    try {
      await api.stopMining();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setStopping(false);
    }
  };

  const resetPoolForm = () => {
    setShowCustomPool(false);
    setEditingPoolUrl(null);
    setCustomName("");
    setCustomUrl("");
    setCustomRegion("");
  };

  const openAddPool = () => {
    setEditingPoolUrl(null);
    setCustomName("");
    setCustomUrl("");
    setCustomRegion("");
    setShowCustomPool(true);
  };

  const openEditPool = (p: PoolInfo) => {
    setEditingPoolUrl(p.url);
    setCustomName(p.name);
    setCustomUrl(p.url);
    setCustomRegion(p.region);
    setShowCustomPool(true);
  };

  const savePool = () => {
    if (!customUrl || !customName) return;
    const newPool: PoolInfo = {
      name: customName,
      url: customUrl,
      region: customRegion,
      builtin: false,
    };
    let updated: PoolInfo[];
    if (editingPoolUrl) {
      // Replace existing
      updated = pools.map((p) =>
        !p.builtin && p.url === editingPoolUrl ? newPool : p,
      );
    } else {
      // Add new
      updated = [...pools, newPool];
    }
    setPools(updated);
    setPoolUrl(customUrl);
    resetPoolForm();
    persistConfig({
      customPools: updated.filter((p) => !p.builtin),
      miningPool: customUrl,
    });
  };

  const deletePool = (url: string) => {
    const updated = pools.filter((p) => p.url !== url);
    setPools(updated);
    if (poolUrl === url && updated.length > 0) {
      setPoolUrl(updated[0].url);
    }
    resetPoolForm();
    persistConfig({
      customPools: updated.filter((p) => !p.builtin),
      miningPool: poolUrl === url ? updated[0]?.url || "" : poolUrl,
    });
  };

  const toggleDevice = (idx: number) => {
    setSelectedDevices((prev) =>
      prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx],
    );
  };

  const maxThreads = navigator.hardwareConcurrency || 16;
  const nodeSynced = nodeStatus?.running && !nodeStatus?.syncing;

  return (
    <PageStagger className="space-y-14 max-w-5xl mx-auto">
      <StaggerItem>
        <SectionHeading
          eyebrow={t("mining.eyebrow")}
          title={t("mining.title")}
          subtitle={t("mining.subtitle")}
        />
        <p className="text-muted text-sm mt-5 max-w-2xl">
          {t("mining.intro")}
        </p>
      </StaggerItem>

      {err && (
        <StaggerItem>
          <div className="card border-danger/40 bg-danger/10 text-danger">
            {err}
          </div>
        </StaggerItem>
      )}

      {status?.error && !err && (
        <StaggerItem>
          <div className="card border-danger/40 bg-danger/10 text-danger">
            {status.error}
          </div>
        </StaggerItem>
      )}

      {/* ── Mode Selector ── */}
      {!isRunning && (
        <StaggerItem>
          <div className="flex gap-2 p-1 rounded-lg bg-bg-elev border border-border w-fit">
            {([
              ["pool", t("mining.mode.pool")],
              ["sologpu", t("mining.mode.sologpu")],
              ["solo", t("mining.mode.solo")],
            ] as const).map(([mode, label]) => {
              const gpuMode = mode === "pool" || mode === "sologpu";
              const disabled = isMac && gpuMode;
              return (
                <button
                  key={mode}
                  className={`px-5 py-2.5 rounded-md text-sm font-medium transition-all ${
                    disabled
                      ? "text-muted/40 cursor-not-allowed"
                      : selectedMode === mode
                        ? "bg-gold text-gold-fg shadow-sm"
                        : "text-muted hover:text-fg"
                  }`}
                  onClick={() => !disabled && setSelectedMode(mode)}
                  disabled={disabled}
                  title={disabled ? t("mining.mac.disabled") : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-3">
            {selectedMode === "pool" && t("mining.mode.pool.desc")}
            {selectedMode === "sologpu" && t("mining.mode.sologpu.desc")}
            {selectedMode === "solo" && t("mining.mode.solo.desc")}
          </p>
          {isMac && (
            <p className="text-xs text-muted/60 mt-1">
              {t("mining.mac.help")}
            </p>
          )}
        </StaggerItem>
      )}

      {/* ── Hashwarp Setup Guide / AV Blocked (GPU modes) ── */}
      {!isRunning && (selectedMode === "pool" || selectedMode === "sologpu") && (hashwarpFound === false || avBlocked) && (
        <StaggerItem>
          <HashwarpSetupGuide
            avBlocked={avBlocked}
            setAvBlocked={setAvBlocked}
            onRetry={() => {
              setAvBlocked(false);
              setHashwarpFound(null);
              api.hashwarpInstalled().then((found) => {
                setHashwarpFound(found);
                if (found) api.detectGPUs().then(setGpus).catch(() => setGpus([]));
              }).catch(() => setHashwarpFound(false));
            }}
          />
        </StaggerItem>
      )}

      {/* ── Configuration ── */}
      {!isRunning && !avBlocked && !((selectedMode === "pool" || selectedMode === "sologpu") && hashwarpFound === false) && (
        <StaggerItem>
          <section className="card space-y-6">
            <div className="eyebrow mb-2">{t("mining.config")}</div>

            {/* Wallet (both modes) */}
            <div>
              <label className="label">{t("mining.wallet")}</label>
              <input
                type="text"
                className="input font-mono"
                placeholder={t("mining.ph.wallet")}
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
            </div>

            {/* Pool-only: worker name & pool selector */}
            {selectedMode === "pool" && (
              <>
                <div>
                  <label className="label">{t("mining.worker")}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={t("mining.ph.worker")}
                    value={worker}
                    onChange={(e) => setWorker(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label">{t("mining.pool")}</label>
                  <select
                    className="input"
                    value={poolUrl}
                    onChange={(e) => setPoolUrl(e.target.value)}
                  >
                    {pools.map((p) => (
                      <option key={p.url} value={p.url}>
                        {p.name}
                        {p.region ? ` (${p.region})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      className="text-xs text-gold hover:text-gold/80 transition-colors"
                      onClick={showCustomPool ? resetPoolForm : openAddPool}
                    >
                      {showCustomPool ? t("common.cancel") : t("mining.addPool")}
                    </button>
                    {(() => {
                      const selected = pools.find((p) => p.url === poolUrl);
                      if (!selected || selected.builtin) return null;
                      return (
                        <>
                          <button
                            className="text-xs text-muted hover:text-fg transition-colors"
                            onClick={() => openEditPool(selected)}
                          >
                            {t("mining.edit")}
                          </button>
                          <button
                            className="text-xs text-danger/70 hover:text-danger transition-colors"
                            onClick={() => deletePool(selected.url)}
                          >
                            {t("mining.remove")}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {showCustomPool && (
                  <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">{t("mining.poolName")}</label>
                        <input
                          type="text"
                          className="input"
                          placeholder={t("mining.ph.poolName")}
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">{t("mining.region")}</label>
                        <input
                          type="text"
                          className="input"
                          placeholder={t("mining.ph.region")}
                          value={customRegion}
                          onChange={(e) => setCustomRegion(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label">{t("mining.stratumUrl")}</label>
                      <input
                        type="text"
                        className="input font-mono"
                        placeholder={t("mining.ph.stratum")}
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-primary"
                        onClick={savePool}
                        disabled={!customName || !customUrl}
                      >
                        {editingPoolUrl ? t("mining.saveChanges") : t("mining.addPoolCta")}
                      </button>
                      <button className="btn-ghost" onClick={resetPoolForm}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* GPU devices (pool & sologpu) */}
            {(selectedMode === "pool" || selectedMode === "sologpu") && (
              <>
                {gpus.length > 0 && (
                  <div>
                    <label className="label">{t("mining.gpuDevices")}</label>
                    <div className="space-y-2 mt-1">
                      {gpus.map((g) => (
                        <label
                          key={g.index}
                          className="flex items-center gap-3 rounded-lg border border-border bg-bg-elev px-4 py-3 cursor-pointer hover:border-fg/20 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={
                              selectedDevices.length === 0 ||
                              selectedDevices.includes(g.index)
                            }
                            onChange={() => toggleDevice(g.index)}
                            className="accent-gold"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-fg truncate">
                              GPU {g.index}: {g.name}
                            </div>
                            <div className="text-xs text-muted">
                              {g.memory}
                              {g.cuda && " · CUDA"}
                              {g.openCl && " · OpenCL"}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    {selectedDevices.length === 0 && (
                      <p className="text-xs text-muted mt-1">
                        {t("mining.gpu.allDefault")}
                      </p>
                    )}
                  </div>
                )}
                {gpus.length === 0 && (
                  <div className="rounded-lg border border-border bg-bg-elev px-4 py-3">
                    <p className="text-sm text-muted">
                      {t("mining.gpu.none")}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Node status (sologpu & solo) */}
            {(selectedMode === "sologpu" || selectedMode === "solo") && (
              <div className="rounded-lg border border-border bg-bg-elev px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={nodeSynced ? "live-dot-success" : "live-dot-err"}
                  />
                  <span className="text-sm">
                    {!nodeStatus?.running
                      ? t("mining.node.notRunning")
                      : nodeStatus.syncing
                        ? t("mining.node.syncing")
                        : t("mining.node.ready")}
                  </span>
                </div>
                {!nodeStatus?.running && (
                  <button
                    className="btn-primary text-sm shrink-0"
                    onClick={async () => {
                      try {
                        await api.startNode();
                      } catch (e: any) {
                        setErr(e?.message || String(e));
                      }
                    }}
                  >
                    {t("mining.startNode")}
                  </button>
                )}
              </div>
            )}

            {/* CPU threads (solo CPU only) */}
            {selectedMode === "solo" && (
              <div>
                <label className="label">
                  {t("mining.cpuThreads")} ({threads} / {maxThreads})
                </label>
                <input
                  type="range"
                  min={1}
                  max={maxThreads}
                  value={threads}
                  onChange={(e) => setThreads(parseInt(e.target.value, 10))}
                  className="w-full accent-gold"
                />
              </div>
            )}

            {/* Start button */}
            <button
              className="btn-primary"
              onClick={start}
              disabled={
                starting ||
                !wallet ||
                (selectedMode === "pool" && !poolUrl) ||
                ((selectedMode === "sologpu" || selectedMode === "solo") && !nodeSynced)
              }
            >
              {starting
                ? t("mining.starting")
                : selectedMode === "pool"
                  ? t("mining.start.pool")
                  : selectedMode === "sologpu"
                    ? t("mining.start.sologpu")
                    : t("mining.start.solo")}
            </button>
          </section>
        </StaggerItem>
      )}

      {/* ── Live Stats ── */}
      {isRunning && status && (
        <StaggerItem>
          <section className="card-featured">
            <div className="flex items-center justify-between mb-7">
              <div className="eyebrow">{t("mining.liveStats")}</div>
              <span className="pill-ok">
                <span className="live-dot-success" />
                {status.generatingDag ? t("mining.generatingDag") : t("mining.mining")}
              </span>
            </div>

            {/* DAG generation indicator */}
            {status.generatingDag && (
              <div className="mb-6">
                <div className="flex justify-between eyebrow mb-3">
                  <span>{t("mining.genDagEpoch")} {status.epoch}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill animate-pulse-soft w-full" />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-6">
              <Stat label={t("mining.hashrate")}>
                <AnimatedNumber
                  value={status.hashrate}
                  format={formatHashrate}
                  className="stat-value"
                />
              </Stat>

              {(status.mode === "pool" || status.mode === "sologpu") && (
                <Stat label={t("mining.shares")}>
                  <span className="stat-value">
                    {status.sharesAccepted.toLocaleString()}
                    {status.sharesRejected > 0 && (
                      <span className="text-danger">
                        /{status.sharesRejected}
                      </span>
                    )}
                    {status.sharesFailed > 0 && (
                      <span className="text-danger">
                        /{status.sharesFailed}F
                      </span>
                    )}
                  </span>
                </Stat>
              )}

              {status.mode === "solo" && (
                <Stat label={t("mining.difficulty")}>
                  <span className="stat-value">
                    {formatDifficulty(status.soloDifficulty || "0")}
                  </span>
                </Stat>
              )}

              <Stat label={t("mining.uptime")}>
                <span className="stat-value">
                  {formatDuration(status.uptimeSeconds)}
                </span>
              </Stat>

              {status.mode === "pool" && (
                <Stat label={t("mining.poolLabel")}>
                  <span className="stat-value text-sm">
                    <span
                      className={
                        status.poolConnected
                          ? "live-dot-success"
                          : "live-dot-err"
                      }
                    />{" "}
                    {status.poolConnected ? t("mining.connected") : t("mining.disconnected")}
                  </span>
                </Stat>
              )}

              {status.mode === "sologpu" && (
                <Stat label={t("mining.nodeLabel")}>
                  <span className="stat-value text-sm">
                    <span
                      className={
                        status.poolConnected
                          ? "live-dot-success"
                          : "live-dot-err"
                      }
                    />{" "}
                    {status.poolConnected ? t("mining.connected") : t("mining.disconnected")}
                  </span>
                </Stat>
              )}

              {status.mode === "solo" && (
                <Stat label={t("mining.blocksFound")}>
                  <span className="stat-value">
                    {status.soloBlocksFound.toLocaleString()}
                  </span>
                </Stat>
              )}
            </div>
          </section>
        </StaggerItem>
      )}

      {/* ── GPU Devices ── */}
      {isRunning &&
        (status?.mode === "pool" || status?.mode === "sologpu") &&
        status?.devices &&
        status.devices.length > 0 && (
          <StaggerItem>
            <section className="card space-y-4">
              <div className="eyebrow mb-2">{t("mining.gpuDevicesStat")}</div>
              <div className="grid gap-3">
                {status.devices.map((d) => (
                  <div
                    key={d.index}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-elev px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-fg truncate">
                        #{d.index} {d.name}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {d.mode} · {d.accepted} {t("mining.accepted")}
                        {d.rejected > 0 && ` · ${d.rejected} ${t("mining.rejected")}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm shrink-0">
                      <span className="font-mono text-fg">
                        {formatHashrate(d.hashrate)}
                      </span>
                      {d.tempC > 0 && (
                        <span
                          className={
                            d.tempC > 80 ? "text-danger" : "text-muted"
                          }
                        >
                          {d.tempC}°C
                        </span>
                      )}
                      {d.fanPct > 0 && (
                        <span className="text-muted">{d.fanPct}%</span>
                      )}
                      {d.powerW > 0 && (
                        <span className="text-muted">
                          {d.powerW.toFixed(0)}W
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </StaggerItem>
        )}

      {/* ── Stop button ── */}
      {isRunning && (
        <StaggerItem>
          <button
            className="btn-danger"
            onClick={stop}
            disabled={stopping}
          >
            {stopping ? t("mining.stopping") : t("mining.stop")}
          </button>
        </StaggerItem>
      )}
    </PageStagger>
  );
}

function HashwarpSetupGuide({ onRetry, avBlocked, setAvBlocked }: {
  onRetry: () => void;
  avBlocked: boolean;
  setAvBlocked: (v: boolean) => void;
}) {
  const t = useT();
  const [installing, setInstalling] = useState(false);
  const [step, setStep] = useState("");
  const [installErr, setInstallErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pendingGpu, setPendingGpu] = useState<"cuda" | "opencl" | null>(null);
  const [fixingAv, setFixingAv] = useState(false);
  const isWindows = navigator.userAgent.includes("Windows");

  // Track whether the backend flagged AV during this install attempt
  const avBlockedRef = useRef(false);

  useEffect(() => {
    const off = window.runtime.EventsOn(
      "hashwarp-install",
      (data: { step: string; detail: string }) => {
        if (data.step === "av-blocked") {
          avBlockedRef.current = true;
          setAvBlocked(true);
          return;
        }
        setStep(
          data.step === "finding"
            ? t("hashwarp.step.finding")
            : data.step === "downloading"
              ? t("hashwarp.step.downloading", { detail: data.detail })
              : data.step === "extracting"
                ? t("hashwarp.step.extracting")
                : data.step === "verifying"
                  ? t("hashwarp.step.verifying")
                  : data.step === "done"
                    ? t("hashwarp.step.done")
                    : data.step,
        );
        if (data.step === "done") setDone(true);
      },
    );
    return () => off();
  }, [setAvBlocked, t]);

  const install = async (gpuType: "cuda" | "opencl") => {
    setInstalling(true);
    setInstallErr(null);
    setAvBlocked(false);
    avBlockedRef.current = false;
    setStep(t("hashwarp.step.starting"));
    setDone(false);
    setPendingGpu(gpuType);
    try {
      await api.installHashwarp(gpuType);
      setTimeout(() => onRetry(), 1000);
    } catch (e: any) {
      if (!avBlockedRef.current) {
        setInstallErr(e?.message || String(e));
      }
    }
  };

  const fixAndRetry = async () => {
    if (!pendingGpu) return;
    setFixingAv(true);
    try {
      await api.addDefenderExclusion();
      setAvBlocked(false);
      avBlockedRef.current = false;
      setInstalling(true);
      setInstallErr(null);
      setStep(t("hashwarp.step.starting"));
      setDone(false);
      await api.installHashwarp(pendingGpu);
      setTimeout(() => onRetry(), 1000);
    } catch (e: any) {
      if (!avBlockedRef.current) {
        setInstallErr(e?.message || String(e));
      }
    } finally {
      setFixingAv(false);
    }
  };

  // ── AV blocked screen ──
  if (avBlocked) {
    return (
      <section className="card space-y-6">
        <div>
          <div className="eyebrow mb-3 text-danger">{t("hashwarp.av.eyebrow")}</div>
          <p className="text-fg text-lg font-medium">
            {t("hashwarp.av.title")}
          </p>
          <p className="text-muted mt-2 text-sm">
            {t("hashwarp.av.desc1")}{" "}
            <strong className="text-fg">{t("hashwarp.av.falsePositive")}</strong>{" "}
            {t("hashwarp.av.desc2")}
          </p>
        </div>

        <div className="space-y-4">
          {/* Automated fix */}
          <div className="rounded-lg border border-gold/30 bg-gold/5 p-4 space-y-3">
            <div className="text-sm text-fg font-medium">{t("hashwarp.av.autoTitle")}</div>
            <p className="text-xs text-muted">
              {t("hashwarp.av.autoDesc")}
            </p>
            <button
              className="btn-primary text-sm"
              onClick={fixAndRetry}
              disabled={fixingAv}
            >
              {fixingAv ? t("hashwarp.av.adding") : t("hashwarp.av.addAndRetry")}
            </button>
          </div>

          {/* Manual instructions */}
          <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
            <div className="text-sm text-fg font-medium">{t("hashwarp.av.manualTitle")}</div>
            <ol className="text-xs text-muted space-y-2 list-decimal list-inside">
              <li>
                {t("hashwarp.av.step1a")}{" "}
                <strong className="text-fg">{t("hashwarp.av.step1b")}</strong>{" "}
                {t("hashwarp.av.step1c")}
              </li>
              <li>
                {t("hashwarp.av.step2a")}{" "}
                <strong className="text-fg">{t("hashwarp.av.step2b")}</strong> →{" "}
                <strong className="text-fg">{t("hashwarp.av.step2c")}</strong>
              </li>
              <li>
                {t("hashwarp.av.step3a")}{" "}
                <strong className="text-fg">{t("hashwarp.av.step3b")}</strong> →{" "}
                <strong className="text-fg">{t("hashwarp.av.step3c")}</strong>
              </li>
              <li>
                {t("hashwarp.av.step4a")}{" "}
                <strong className="text-fg">{t("hashwarp.av.step4b")}</strong> →{" "}
                {t("hashwarp.av.step4c")}{" "}
                <strong className="text-fg">{t("hashwarp.av.step4d")}</strong> →{" "}
                {t("hashwarp.av.step4e")}
              </li>
              <li>{t("hashwarp.av.step5")}</li>
            </ol>
            <button className="btn-ghost text-sm" onClick={() => {
              setAvBlocked(false);
              if (pendingGpu) install(pendingGpu);
            }}>
              {t("hashwarp.av.retry")}
            </button>
          </div>
        </div>

        <button
          className="btn-ghost text-sm"
          onClick={() => {
            setAvBlocked(false);
            setInstalling(false);
            setPendingGpu(null);
          }}
        >
          {t("hashwarp.av.back")}
        </button>
      </section>
    );
  }

  // ── Installing screen ──
  if (installing) {
    return (
      <section className="card space-y-6">
        <div className="eyebrow">{t("hashwarp.installing.eyebrow")}</div>
        <div className="flex items-center gap-4">
          {!done && !installErr && (
            <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          )}
          {done && (
            <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center text-xs text-bg font-bold">
              ✓
            </div>
          )}
          <span className="text-fg text-sm">{step}</span>
        </div>
        {!done && !installErr && (
          <div className="progress-track">
            <div className="progress-fill animate-pulse-soft w-full" />
          </div>
        )}
        {installErr && (
          <div className="space-y-3">
            <div className="rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm px-4 py-3">
              {installErr}
            </div>
            <button
              className="btn-ghost text-sm"
              onClick={() => setInstalling(false)}
            >
              {t("hashwarp.installing.back")}
            </button>
          </div>
        )}
      </section>
    );
  }

  // ── Initial setup screen ──
  return (
    <section className="card space-y-6">
      <div>
        <div className="eyebrow mb-3">{t("hashwarp.setup.eyebrow")}</div>
        <p className="text-fg text-lg font-medium">
          {t("hashwarp.setup.title")}
        </p>
        <p className="text-muted mt-2 text-sm">
          {t("hashwarp.setup.desc")}
        </p>
      </div>

      {isWindows && (
        <div className="rounded-lg border border-border bg-bg-elev px-4 py-3">
          <p className="text-xs text-muted">
            <strong className="text-fg">{t("hashwarp.setup.winNoteBold")}</strong>{" "}
            {t("hashwarp.setup.winNote")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <button
          className="group rounded-lg border border-border bg-bg-elev p-5 text-left hover:border-gold/40 hover:shadow-[0_0_30px_rgb(247_147_26/0.08)] transition-all"
          onClick={() => install("cuda")}
        >
          <div className="text-fg font-medium text-base mb-1">NVIDIA</div>
          <div className="text-xs text-muted">
            {t("hashwarp.setup.nvidiaSeries")}
          </div>
          <div className="text-xs text-gold mt-3 opacity-70 group-hover:opacity-100 transition-opacity">
            {t("hashwarp.setup.downloadCuda")}
          </div>
        </button>
        <button
          className="group rounded-lg border border-border bg-bg-elev p-5 text-left hover:border-gold/40 hover:shadow-[0_0_30px_rgb(247_147_26/0.08)] transition-all"
          onClick={() => install("opencl")}
        >
          <div className="text-fg font-medium text-base mb-1">AMD</div>
          <div className="text-xs text-muted">
            {t("hashwarp.setup.amdSeries")}
          </div>
          <div className="text-xs text-gold mt-3 opacity-70 group-hover:opacity-100 transition-opacity">
            {t("hashwarp.setup.downloadOpenCl")}
          </div>
        </button>
      </div>

      {!isWindows && (
        <p className="text-xs text-muted">
          {t("hashwarp.setup.linuxHintA")}{" "}
          <code className="text-fg bg-bg-elev px-1.5 py-0.5 rounded text-xs">
            lspci | grep -i vga
          </code>{" "}
          {t("hashwarp.setup.linuxHintB")}
        </p>
      )}
      {isWindows && (
        <p className="text-xs text-muted">
          {t("hashwarp.setup.winHint")}
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="stat-label mb-2">{label}</div>
      {children}
    </div>
  );
}
