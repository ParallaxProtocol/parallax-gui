// Typed wrapper around the backend's App methods (app.go), which the
// Electron shell's preload script (desktop/src/preload.ts) exposes as
// window.parallax.

declare global {
  interface Window {
    parallax?: {
      call: (method: string, args: unknown[]) => Promise<unknown>;
      on: (event: string, cb: (data: any) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
      setTheme: (pref: "system" | "light" | "dark") => void;
      loginItem: () => Promise<{ supported: boolean; enabled: boolean }>;
      setLoginItem: (on: boolean) => Promise<void>;
      keepAwake: (on: boolean) => void;
      platform: string;
      material?: boolean;
    };
  }
}

/** Open a URL in the user's default browser. */
export function openExternal(url: string) {
  if (window.parallax) window.parallax.openExternal(url);
  else window.open(url, "_blank", "noreferrer");
}

/**
 * onEvent subscribes to a backend event (logs, update-progress, node…)
 * and returns the unsubscribe function.
 */
export function onEvent<T = any>(event: string, cb: (data: T) => void): () => void {
  return window.parallax ? window.parallax.on(event, cb) : () => {};
}

const call = <T = any>(method: string, ...args: any[]): Promise<T> => {
  if (!window.parallax) {
    return Promise.reject(new Error(`backend method ${method} unavailable`));
  }
  return window.parallax.call(method, args) as Promise<T>;
};

export type GUIConfig = {
  bootstrapped: boolean;
  dataDir: string;
  syncMode: "snap" | "full";
  httpRpcEnabled: boolean;
  httpRpcPort: number;
  blockInbound: boolean;
  maxPeers: number;
  theme: "system" | "light" | "dark";
  autoStartNode: boolean;
  disableAnimations: boolean;
  enableSmartFee: boolean;
  reportStats: boolean;
  databaseCacheMB: number;
  trieCleanCacheMB: number;
  trieDirtyCacheMB: number;
  snapshotCacheMB: number;
  /** The Wallet page's watched address. */
  watchAddress: string;
  /** Kept by the backend, which carries them over on save. */
  staticPeers?: string[] | null;
  trustedPeers?: string[] | null;

  // The daemon's command-line flags (backend/types.go). An empty string,
  // null or false keeps the CLI default.
  nodeName: string;
  archiveMode: boolean;
  txLookupLimit: number | null;
  noSnapshot: boolean;
  ancientDir: string;
  minFreeDiskMB: number | null;
  fdLimit: number;
  noPrefetch: boolean;
  preimages: boolean;

  listenPort: number;
  natMode: "" | "upnp" | "pmp" | "extip";
  externalIp: string;
  maxPendingPeers: number;
  noDiscovery: boolean;
  legacyDiscovery: "" | "on" | "off";
  netRestrict: string;
  bootnodes: string[] | null;

  proxy: string;
  onionProxy: string;
  onlyNet: string[] | null;
  proxyNoRandomize: boolean;
  noListenOnion: boolean;
  torControl: string;
  torPassword: string;

  httpHost: string;
  httpApis: string[] | null;
  httpCors: string[] | null;
  httpVhosts: string[] | null;
  wsEnabled: boolean;
  wsHost: string;
  wsPort: number;
  wsApis: string[] | null;
  wsOrigins: string[] | null;
  graphql: boolean;
  ipcDisabled: boolean;
  rpcGasCap: number | null;
  rpcTxFeeCap: number | null;
  rpcPvmTimeoutSec: number | null;
  rpcLogQueryLimit: number | null;
  rpcBatchLimit: number | null;
  allowUnprotectedTxs: boolean;

  txPoolLocals: string[] | null;
  txPoolNoLocals: boolean;
  txPoolPriceLimit: number | null;
  txPoolPriceBump: number | null;
  txPoolAccountSlots: number | null;
  txPoolGlobalSlots: number | null;
  txPoolAccountQueue: number | null;
  txPoolGlobalQueue: number | null;
  txPoolLifetimeMin: number | null;

  gpoBlocks: number | null;
  gpoPercentile: number | null;
  gpoMaxPrice: string;
  gpoIgnorePrice: string;

  metrics: boolean;
  metricsExpensive: boolean;
  metricsAddr: string;
  metricsPort: number;

  // Desktop
  /** 1 (errors) to 5 (trace); 0 is the default, info. */
  logLevel: number;
  noUpdateCheck: boolean;
  preventSleep: boolean;
  notifications: boolean;
};

export type NodeStatus = {
  running: boolean;
  syncing: boolean;
  currentBlock: number;
  highestBlock: number;
  startingBlock: number;
  peers: number;
  chainId: number;
  networkId: number;
  dataDir: string;
  uptimeSeconds: number;
  diskUsedBytes: number;
  memUsedBytes: number;
  clientVersion: string;
  rpcEndpoint: string;
};

/** The Overview's fuller picture of the running node (backend NodeDetails). Amounts are decimal wei strings. */
export type NodeDetails = {
  running: boolean;
  nodeId: string;
  /** Empty in v2-only mode, where no persistent identity is dialable. */
  enode: string;
  clientName: string;
  daemonVersion: string;
  externalIp: string;
  listenPort: number;
  inboundAllowed: boolean;
  maxPeers: number;
  v2Only: boolean;
  totalDifficulty: string;
  blockRewardWei: string;
  nextHalvingBlock: number;
  blocksToHalving: number;
  txPending: number;
  txQueued: number;
  /** The pool's size: its transactions' encoded bytes. */
  txBytes: number;
  gasPriceWei: string;
  smartFee: boolean;
  smartFeeWei: string;
  smartFeeTarget: number;
  smartFeeBlocks: number;
  smartFeeFallback: boolean;
  diskFreeBytes: number;
  diskStopBelowBytes: number;
  syncModeConfigured: string;
  syncModeActive: string;
  archiveMode: boolean;
  snapAccounts: number;
  snapStorage: number;
  snapBytes: number;
  snapHealing: number;
  statsName: string;
  statsHost: string;
};

/** One transaction waiting in the node's pool (backend MempoolTx). `to` is empty for a contract creation. */
export type MempoolTx = {
  hash: string;
  from: string;
  to: string;
  nonce: number;
  valueWei: string;
  gasPriceWei: string;
  gas: number;
  sizeBytes: number;
  dataBytes: number;
  type: number;
  /** Not minable yet: a nonce gap, or too little balance, holds it back. */
  queued: boolean;
};

/** A page of the pool: its totals, how many match the query, and the first of them. */
export type MempoolView = {
  pending: number;
  queued: number;
  matched: number;
  txs: MempoolTx[];
};

/** One entry of the node's ban list. Times are unix seconds. */
export type BanEntry = {
  subnet: string;
  createdAt: number;
  bannedUntil: number;
};

export type WalletStatus = {
  connected: boolean;
  lastSeenUnixMilli: number;
};

export type LogLine = {
  ts: number;
  level: string;
  msg: string;
};

export type PeerView = {
  id: string;
  fullId: string;
  enode: string;
  name: string;
  remoteAddr: string;
  localAddr: string;
  address?: string;
  network: string;
  minPingMs?: number;
  inbound: boolean;
  trusted: boolean;
  static: boolean;
  caps: string[];
  protocols?: Record<string, any>;
};

export type BlockView = {
  number: number;
  hash: string;
  timestamp: number;
  txCount: number;
  gasUsed: number;
  gasLimit: number;
  sizeBytes: number;
  rewardWei: string;
  difficulty: string;
};

export type TxView = {
  hash: string;
  block: number;
  timestamp: number;
  from: string;
  to: string;
  valueWei: string;
  gasUsed: number;
  kind: "transfer" | "contract" | "call";
};

export type AddressView = {
  address: string;
  /** Empty while the head state is unavailable (snap sync in progress). */
  balanceWei: string;
  nonce: number;
  headBlock: number;
  /** The oldest block the activity below was gathered from. */
  scannedFrom: number;
  transactions: TxView[];
};

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseURL: string;
  assetURL: string;
  assetName: string;
  assetSize: number;
  publishedAt: string;
};

export type UpdateProgress = {
  step: "downloading" | "verifying" | "extracting" | "ready" | "ready-manual" | "error";
  percent: number;
  detail: string;
};

export const api = {
  bootstrapNeeded: () => call<boolean>("BootstrapNeeded"),
  saveBootstrap: (cfg: GUIConfig) => call<void>("SaveBootstrap", cfg),
  getConfig: () => call<GUIConfig>("GetConfig"),
  updateConfig: (cfg: GUIConfig) => call<void>("UpdateConfig", cfg),

  startNode: () => call<void>("StartNode"),
  stopNode: () => call<void>("StopNode"),
  nodeStatus: () => call<NodeStatus>("NodeStatus"),
  nodeDetails: () => call<NodeDetails>("NodeDetails"),
  mempool: (query: string, limit: number) => call<MempoolView>("Mempool", query, limit),

  // Peer management: targets are enode URLs or ip:port; bans take an IP, a CIDR or a host:port
  addPeer: (target: string) => call<void>("AddPeer", target),
  disconnectPeer: (target: string) => call<void>("DisconnectPeer", target),
  setPeerTrusted: (enode: string, trusted: boolean) => call<void>("SetPeerTrusted", enode, trusted),
  banPeer: (subnet: string, seconds: number) => call<void>("BanPeer", subnet, seconds),
  unbanPeer: (subnet: string) => call<void>("UnbanPeer", subnet),
  clearBanned: () => call<void>("ClearBanned"),
  banned: () => call<BanEntry[]>("Banned"),
  walletStatus: () => call<WalletStatus>("WalletStatus"),
  peers: () => call<PeerView[]>("Peers"),
  recentBlocks: (n: number) => call<BlockView[]>("RecentBlocks", n),
  recentTransactions: (n: number) => call<TxView[]>("RecentTransactions", n),
  addressSummary: (addr: string) => call<AddressView>("AddressSummary", addr),

  getLogTail: (n: number) => call<LogLine[]>("GetLogTail", n),
  setLogVerbosity: (n: number) => call<void>("SetLogVerbosity", n),

  metaMaskHelperURL: () => call<string>("MetaMaskHelperURL"),

  version: () => call<string>("Version"),
  clientVersion: () => call<string>("ClientVersion"),

  // Auto-update
  checkForUpdate: () => call<UpdateInfo | null>("CheckForUpdate"),
  getLatestUpdate: () => call<UpdateInfo | null>("GetLatestUpdate"),
  applyUpdate: () => call<void>("ApplyUpdate"),
  dismissUpdate: () => call<void>("DismissUpdate"),
  restartApp: () => call<void>("RestartApp"),
};
