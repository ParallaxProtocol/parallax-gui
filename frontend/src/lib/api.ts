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
      saveBackup: (fileName: string, contents: string) => Promise<boolean>;
      platform: string;
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
  /** How addresses are pictured; "" is Jazzicon. */
  avatarStyle: "" | "jazzicon" | "blockies";
  autoStartNode: boolean;
  disableAnimations: boolean;
  enableSmartFee: boolean;
  reportStats: boolean;
  databaseCacheMB: number;
  trieCleanCacheMB: number;
  trieDirtyCacheMB: number;
  snapshotCacheMB: number;
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
  /** Start each run with an empty log; otherwise the latest lines are kept across restarts. */
  clearLogsOnStartup: boolean;
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

/**
 * What the node takes of the computer (backend Usage): byte counts since
 * the app started (peers, disk), the CPU time it has used (seconds), and
 * the machine's CPU load and I/O wait as shares (0..1) of all its cores.
 * counted is false when the daemon isn't collecting metrics; cpuCounted
 * when the system wouldn't give the CPU time.
 */
export type Usage = {
  counted: boolean;
  inBytes: number;
  outBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  cpuCounted: boolean;
  cpuSeconds: number;
  cpuSystem: number;
  cpuWait: number;
  cores: number;
};

/** The Overview's fuller picture of the running node (backend NodeDetails). Amounts are decimal wei strings. */
export type NodeDetails = {
  running: boolean;
  nodeId: string;
  /** Empty in v2-only mode, where no persistent identity is dialable. */
  enode: string;
  clientName: string;
  daemonVersion: string;
  /** The Parallax client's version in parts: number, label ("stable"), commit (empty when unknown). */
  daemonRelease: string;
  daemonMeta: string;
  daemonCommit: string;
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

export type LogLine = {
  ts: number;
  level: string;
  msg: string;
  /** "app" for this app's own code (wallet, updater, setup), "node" for the Parallax client's. */
  source: "app" | "node";
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
  /** Its transactions in the pool, not yet in a block (block and timestamp are 0). */
  pending: TxView[];
};

// ---------------------------------------------------------------------------
// Wallet (backend/wallet.go)
// ---------------------------------------------------------------------------

export type WalletAccount = {
  /** EIP-55 checksummed. */
  address: string;
  name: string;
  /** Saved to a backup, imported from elsewhere, or from a confirmed recovery phrase: not the only copy. */
  backedUp: boolean;
  /** Made from recovery phrase seedId, at seedPath; seedStandard when that is m/44'/60'/0'/0/seedIndex. */
  fromSeed: boolean;
  seedId: string;
  seedPath: string;
  seedIndex: number;
  seedStandard: boolean;
};

export type WalletInfo = {
  accounts: WalletAccount[];
  /** Empty when there are no accounts. */
  selected: string;
  keystoreDir: string;
  /** The wallet password is set; needsSetup when the keystore has keys but no password yet. */
  hasPassword: boolean;
  needsSetup: boolean;
  /** The recovery phrases, in the order they were added. */
  seeds: SeedInfo[];
};

/** A recovery phrase as the app shows it: nothing secret. */
export type SeedInfo = {
  id: string;
  name: string;
  confirmed: boolean;
  hasPassphrase: boolean;
  accounts: number;
};

/** A recovery phrase made or shown: its words, its passphrase ("" for none), and the account made with it. */
export type SeedPhrase = { seedId: string; words: string[]; passphrase: string; account: WalletAccount };

/** Where wallets put accounts under a phrase: MetaMask's standard path, Ledger Live's, the legacy one. */
export type SeedScheme = "standard" | "ledgerlive" | "legacy";

/** An account a phrase holds, as a scan of it found. balanceWei is empty while the node can't read it. */
export type SeedCandidate = {
  scheme: SeedScheme;
  index: number;
  path: string;
  address: string;
  balanceWei: string;
  nonce: number;
  used: boolean;
  inWallet: boolean;
};

export type SeedPick = { scheme: SeedScheme; index: number };

/** An account's keystore file, still encrypted. */
export type WalletBackup = { fileName: string; keyfile: string };

/** What a send would cost, worked out by the node. Amounts are decimal wei strings. */
export type SendQuote = {
  from: string;
  to: string;
  valueWei: string;
  gasPriceWei: string;
  suggestedPriceWei: string;
  gasLimit: number;
  feeWei: string;
  totalWei: string;
  balanceWei: string;
  maxValueWei: string;
  sufficient: boolean;
  toContract: boolean;
  toSelf: boolean;
  chainId: number;
};

export type SendRequest = {
  from: string;
  to: string;
  valueWei: string;
  gasPriceWei: string;
  gasLimit: number;
  password: string;
};

export type SentTx = { hash: string; nonce: number };

/**
 * The wallet's errors the app says in the user's language, by the
 * backend's message (backend/wallet.go): the key is the i18n key.
 */
const WALLET_ERRORS: Record<string, string> = {
  "wallet: wrong password": "wallet.err.wrongPassword",
  "wallet: the password must be at least 8 characters": "wallet.err.weakPassword",
  "wallet: the password must be at most 1024 characters": "wallet.err.longPassword",
  "wallet: no such account in this wallet": "wallet.err.unknownAccount",
  "wallet: this account is already in the wallet": "wallet.err.exists",
  "wallet: not a valid private key": "wallet.err.badKey",
  "wallet: not a valid keystore file": "wallet.err.badKeyfile",
  "wallet: not a valid recipient address": "wallet.err.badRecipient",
  "wallet: the recipient address fails its checksum": "wallet.err.badChecksum",
  "wallet: not a valid amount": "wallet.err.badAmount",
  "wallet: not a valid fee": "wallet.err.badFee",
  "wallet: the fee is below what the node suggests": "wallet.err.feeTooLow",
  "wallet: the node is not running": "wallet.err.nodeStopped",
  "wallet: the node is still syncing": "wallet.err.syncing",
  "wallet: the node has no peers to send the transaction to": "wallet.err.noPeers",
  "wallet: the balance does not cover the amount and the fee": "wallet.err.insufficient",
  "wallet: this recovery phrase is already in the wallet": "wallet.err.seedExists",
  "wallet: not a valid recovery phrase": "wallet.err.badMnemonic",
  "wallet: the passphrase is too long": "wallet.err.longPassphrase",
  "wallet: no such recovery phrase in this wallet": "wallet.err.unknownSeed",
  "wallet: the wallet has no password yet": "wallet.err.noPassword",
  "wallet: set the wallet password first": "wallet.err.needsSetup",
  "wallet: this account's key is under a different password": "wallet.err.keyMismatch",
  "wallet: the password doesn't open every key in the wallet": "wallet.err.setupMismatch",
  "wallet: wrong password for the keystore file": "wallet.err.wrongFilePassword",
};

/** walletError says a wallet call's failure in the user's language when it is a known one. */
export function walletError(e: unknown, t: (key: string) => string): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Some carry what they are about after a colon: the address of a key
  const key = WALLET_ERRORS[msg] ?? WALLET_ERRORS[msg.replace(/: 0x[0-9a-fA-F]{40}$/, "")];
  return key ? t(key) : msg;
}

/** Saves an account's encrypted keystore file where the user picks; false if cancelled. */
export function saveBackup(fileName: string, contents: string): Promise<boolean> {
  if (!window.parallax) return Promise.reject(new Error("unavailable"));
  return window.parallax.saveBackup(fileName, contents);
}

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
  nodeUsage: () => call<Usage>("NodeUsage"),
  mempool: (query: string, limit: number) => call<MempoolView>("Mempool", query, limit),

  // Peer management: targets are enode URLs or ip:port; bans take an IP, a CIDR or a host:port
  addPeer: (target: string) => call<void>("AddPeer", target),
  disconnectPeer: (target: string) => call<void>("DisconnectPeer", target),
  setPeerTrusted: (enode: string, trusted: boolean) => call<void>("SetPeerTrusted", enode, trusted),
  banPeer: (subnet: string, seconds: number) => call<void>("BanPeer", subnet, seconds),
  unbanPeer: (subnet: string) => call<void>("UnbanPeer", subnet),
  clearBanned: () => call<void>("ClearBanned"),
  banned: () => call<BanEntry[]>("Banned"),
  peers: () => call<PeerView[]>("Peers"),
  recentBlocks: (n: number) => call<BlockView[]>("RecentBlocks", n),
  recentTransactions: (n: number) => call<TxView[]>("RecentTransactions", n),

  // Wallet. Passwords travel to the backend only, for the one action they're given for
  walletInfo: () => call<WalletInfo>("WalletInfo"),
  walletSelect: (address: string) => call<void>("WalletSelect", address),
  walletRename: (address: string, name: string) => call<void>("WalletRename", address, name),
  walletCreate: (name: string, password: string) => call<WalletAccount>("WalletCreate", name, password),
  walletImportPrivateKey: (name: string, key: string, password: string) =>
    call<WalletAccount>("WalletImportPrivateKey", name, key, password),
  walletImportKeyfile: (name: string, keyJSON: string, filePassword: string, password: string) =>
    call<WalletAccount>("WalletImportKeyfile", name, keyJSON, filePassword, password),
  walletSetupPassword: (password: string) => call<void>("WalletSetupPassword", password),
  walletChangePassword: (oldPassword: string, newPassword: string) =>
    call<void>("WalletChangePassword", oldPassword, newPassword),
  walletCreateSeed: (name: string, password: string, passphrase: string) =>
    call<SeedPhrase>("WalletCreateSeed", name, password, passphrase),
  walletScanSeed: (words: string, passphrase: string, scheme: SeedScheme, from: number, count: number) =>
    call<SeedCandidate[]>("WalletScanSeed", words, passphrase, scheme, from, count),
  walletImportSeed: (name: string, words: string, passphrase: string, password: string, picks: SeedPick[]) =>
    call<WalletAccount>("WalletImportSeed", name, words, passphrase, password, picks),
  walletDeriveAccount: (seedId: string, name: string, password: string) =>
    call<WalletAccount>("WalletDeriveAccount", seedId, name, password),
  walletRevealSeed: (seedId: string, password: string) => call<SeedPhrase>("WalletRevealSeed", seedId, password),
  walletConfirmSeed: (seedId: string) => call<void>("WalletConfirmSeed", seedId),
  walletRenameSeed: (seedId: string, name: string) => call<void>("WalletRenameSeed", seedId, name),
  walletRemoveSeed: (seedId: string, password: string) => call<void>("WalletRemoveSeed", seedId, password),
  walletBackup: (address: string, password: string) => call<WalletBackup>("WalletBackup", address, password),
  walletMarkBackedUp: (address: string) => call<void>("WalletMarkBackedUp", address),
  walletRemove: (address: string, password: string) => call<void>("WalletRemove", address, password),
  walletSummary: (address: string) => call<AddressView>("WalletSummary", address),
  walletQuote: (from: string, to: string, valueWei: string, gasPriceWei: string) =>
    call<SendQuote>("WalletQuote", from, to, valueWei, gasPriceWei),
  walletSend: (req: SendRequest) => call<SentTx>("WalletSend", req),

  getLogTail: (n: number) => call<LogLine[]>("GetLogTail", n),
  clearLogs: () => call<void>("ClearLogs"),
  setLogVerbosity: (n: number) => call<void>("SetLogVerbosity", n),

  version: () => call<string>("Version"),

  // Auto-update
  checkForUpdate: () => call<UpdateInfo | null>("CheckForUpdate"),
  getLatestUpdate: () => call<UpdateInfo | null>("GetLatestUpdate"),
  applyUpdate: () => call<void>("ApplyUpdate"),
  dismissUpdate: () => call<void>("DismissUpdate"),
  restartApp: () => call<void>("RestartApp"),
};
