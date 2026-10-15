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
      protectContent: (on: boolean) => void;
      saveBackup: (fileName: string, contents: string) => Promise<boolean>;
      exportContacts: (format: "json" | "csv", contents: string) => Promise<boolean>;
      saveSigningDoc: (fileName: string, contents: string) => Promise<boolean>;
      cameraAccess: () => Promise<boolean>;
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
  /** Minutes the wallet stays unlocked with nothing done: 0 for the default (15), -1 for as long as the app runs. */
  autoLockMinutes: number;

  /** Serve the node's chain data to AI assistants (MCP) on 127.0.0.1; applied at once. */
  mcpEnabled: boolean;
  /** The assistant server's port; 0 is 8549. */
  mcpPort: number;
  /** What assistants may see and do in the app, beyond the chain. */
  mcpAllow: MCPAllow;

  /** The whole app is an offline signer: no node, no update checks (takes effect on restart). */
  offlineSigner: boolean;
  /** The most fee a signed request may pay, decimal wei; empty is 1 LAX. */
  offlineFeeCapWei: string;

  // Development builds only (make dev)
  /** Run a private `parallaxd --dev` chain instead of mainnet. */
  devChain: boolean;
  /** The address the development chain's genesis funds. */
  devFundAddress: string;
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
  /** Running the private development chain (make dev only). */
  devChain: boolean;
  /** The development chain holds its blocks back: what is sent waits in the pool. */
  devHeld: boolean;
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

/** Everything the node knows of one transaction (backend/txdetails.go). Amounts are decimal wei. */
export type TxDetails = {
  hash: string;
  status: "pending" | "success" | "failed";
  /** Zero while pending */
  block: number;
  blockHash: string;
  index: number;
  timestamp: number;
  from: string;
  /** Empty for a contract creation */
  to: string;
  contractAddress: string;
  valueWei: string;
  nonce: number;
  gasLimit: number;
  /** Zero while pending */
  gasUsed: number;
  /** The whole price per gas: Parallax has no base fee */
  gasPriceWei: string;
  /** What it paid; while pending, the most it can */
  feeWei: string;
  input: string;
  sizeBytes: number;
  logs: number;
};

/** A wallet account's transaction in a block, for the app's notifications. */
export type WalletTx = TxView & { failed: boolean };

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
  /** Its key is on an offline signer: sends from it are signing requests. */
  watchOnly: boolean;
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
  /** The wallet has a password and isn't unlocked: the lock screen shows (backend/session.go). */
  locked: boolean;
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

/** An account picked from a scan of a phrase, and the name it takes (none if absent). */
export type SeedPick = { scheme: SeedScheme; index: number; name?: string };

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
};

export type SentTx = { hash: string; nonce: number };

/** Speeding up resends a waiting transaction at a higher fee; cancelling sends 0 LAX to the account itself at its nonce. */
export type ReplaceKind = "speedUp" | "cancel";

/** What a speed-up or cancel costs (backend/wallet_replace.go). Amounts are decimal wei. */
export type ReplaceQuote = {
  kind: ReplaceKind;
  /** The waiting transaction it replaces. */
  hash: string;
  from: string;
  /** The replacement's recipient: the account itself for a cancel. */
  to: string;
  nonce: number;
  valueWei: string;
  gasLimit: number;
  oldPriceWei: string;
  gasPriceWei: string;
  oldFeeWei: string;
  feeWei: string;
  totalWei: string;
  balanceWei: string;
  sufficient: boolean;
};

export type ReplaceRequest = {
  from: string;
  hash: string;
  kind: ReplaceKind;
  gasPriceWei: string;
};

/** A transfer as both sides of offline signing show it (backend/offline.go). Amounts are decimal wei. */
export type OfflineTx = {
  id: string;
  /** The short form of id both screens show: 3FA2-91C0 */
  fingerprint: string;
  chainId: number;
  from: string;
  to: string;
  valueWei: string;
  nonce: number;
  gasLimit: number;
  gasPriceWei: string;
  maxFeeWei: string;
  totalWei: string;
  memo: string;
  createdAt: number;
};

/** A signing request: its document (the QR code's and the file's content) and what it says. */
export type SigningRequest = { doc: string; tx: OfflineTx };

/** A request on the signer, before signing. */
export type RequestReview = { tx: OfflineTx; conflict: boolean; signed: boolean };

/** What the signer hands back. */
export type SignedOffline = { doc: string; hash: string; tx: OfflineTx };

/** A signed transaction, checked before it is broadcast. */
export type SignedReview = {
  tx: OfflineTx;
  hash: string;
  /** It answers one of the wallet's own requests. */
  matched: boolean;
  warnings: ("priceLow" | "nonceGap" | "balanceLow")[];
};

/** A message and its signature (backend/message.go); signature is 0x with v 27/28. */
export type SignedMessage = {
  address: string;
  message: string;
  signature: string;
  id: string;
  fingerprint: string;
  /** The signed document, from the offline signer */
  doc?: string;
};

/** What verifying found: whether it is from the address, and who it is from. */
export type MessageCheck = { valid: boolean; recovered: string };

/** A message signing request for a watch-only account's offline signer. */
export type MessageRequest = {
  doc: string;
  id: string;
  fingerprint: string;
  from: string;
  message: string;
  createdAt: number;
};

/** A request the wallet follows until its transaction is in a block. */
export type PendingRequest = {
  doc: string;
  tx: OfflineTx;
  status: "waiting" | "broadcast" | "replaced" | "stale";
  txHash: string;
  sentAt: number;
  replaces: string;
};

export type OfflineRequestInput = {
  from: string;
  to: string;
  valueWei: string;
  gasPriceWei: string;
  gasLimit: number;
  memo: string;
};

/** A contact (backend/contacts.go). Times are Unix seconds; lastSentAt 0 until sent to. */
export type Contact = {
  id: string;
  name: string;
  /** EIP-55 checksummed */
  address: string;
  note: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastSentAt: number;
};

export type ContactInput = { name: string; address: string; note: string };

/** What an import did; errors explains the first few invalid entries. */
export type ContactsImport = { added: number; skipped: number; invalid: number; errors: string[] };

/**
 * The wallet's errors the app says in the user's language, by the
 * backend's message (backend/wallet.go): the key is the i18n key.
 */
const WALLET_ERRORS: Record<string, string> = {
  "wallet: wrong password": "wallet.err.wrongPassword",
  "wallet: the wallet is locked": "wallet.err.locked",
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
  "wallet: the accounts picked are already in the wallet": "wallet.err.accountsInWallet",
  "wallet: not a valid recovery phrase": "wallet.err.badMnemonic",
  "wallet: the passphrase is too long": "wallet.err.longPassphrase",
  "wallet: no such recovery phrase in this wallet": "wallet.err.unknownSeed",
  "wallet: the wallet has no password yet": "wallet.err.noPassword",
  "wallet: set the wallet password first": "wallet.err.needsSetup",
  "wallet: this account is watch-only: its key is on an offline signer": "wallet.err.watchOnly",
  "wallet: the transaction is no longer waiting: it is in a block or was replaced": "wallet.err.notWaiting",
  "wallet: the transaction is not sent from this account": "wallet.err.notYourTx",
  "offline: this app is an offline signer: it never goes online": "offline.err.signer",
  "offline: not a signing request": "offline.err.format",
  "offline: the signing request is from a newer version of the app": "offline.err.version",
  "offline: the signing request is for another network": "offline.err.chain",
  "offline: only plain LAX transfers can be signed": "offline.err.data",
  "offline: the signing request's gas is not valid": "offline.err.gas",
  "offline: the fee is above the signing fee cap": "offline.err.feeCap",
  "offline: the signing request does not match its fingerprint": "offline.err.tampered",
  "offline: the signing request is for an account this wallet doesn't hold": "offline.err.account",
  "offline: no such signing request": "offline.err.unknown",
  "offline: the memo is longer than 200 characters": "offline.err.memo",
  "offline: not a signed transaction": "offline.err.signedFormat",
  "offline: the signed transaction does not match its signing request": "offline.err.mismatch",
  "offline: the signed transaction is for another network": "offline.err.chain",
  "offline: the transaction is not signed by an account of this wallet": "offline.err.sender",
  "offline: this transaction's nonce has already been used": "offline.err.nonceUsed",
  "offline: signing requests are for watch-only accounts": "offline.err.notWatch",
  "offline: the signing fee cap must be more than 0 LAX": "offline.err.feeCapZero",
  "offline: this needs the node, which an offline signer never starts": "offline.err.signer",
  "message: the message must be 1 to 1024 bytes of text, without control characters": "message.err.text",
  "message: not a valid signature": "message.err.signature",
  "message: not a valid address": "message.err.address",
  "message: not a message signing request": "message.err.request",
  "message: not a signed message": "message.err.signed",
  "message: the message does not match its fingerprint": "message.err.tampered",
  "contacts: a contact needs a name of at most 64 characters": "contacts.err.name",
  "contacts: the note is longer than 500 characters": "contacts.err.note",
  "contacts: this address is already in your contacts": "contacts.err.exists",
  "contacts: another contact already has this name": "contacts.err.nameUsed",
  "contacts: no such contact": "contacts.err.unknown",
  "contacts: the contacts are full": "contacts.err.full",
  "contacts: not a contacts file": "contacts.err.file",
  "contacts: the contacts could not be opened": "contacts.err.unavailable",
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

/** Saves a signing request or signed transaction where the user picks; false if cancelled. */
export function saveSigningDoc(fileName: string, contents: string): Promise<boolean> {
  if (!window.parallax) return Promise.reject(new Error("unavailable"));
  return window.parallax.saveSigningDoc(fileName, contents);
}

/** Asks for the camera where the OS needs asking; whether it may be used. */
export function cameraAccess(): Promise<boolean> {
  return window.parallax?.cameraAccess ? window.parallax.cameraAccess() : Promise.resolve(true);
}

/** Saves exported contacts where the user picks; false if cancelled. */
export function exportContacts(format: "json" | "csv", contents: string): Promise<boolean> {
  if (!window.parallax) return Promise.reject(new Error("unavailable"));
  return window.parallax.exportContacts(format, contents);
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

/**
 * How the app answers an assistant's use of a feature: without asking, by
 * asking the user (allow once, always, or not), or not at all.
 */
export type MCPMode = "allow" | "ask" | "block";

/** What AI assistants may see, do, and ask for (each request approved in the app), feature by feature. */
export type MCPAllow = {
  nodeStatus: MCPMode;
  nodeLogs: MCPMode;
  wallet: MCPMode;
  contacts: MCPMode;
  /** Ask the public block explorer; restarts the assistant server. */
  explorer: boolean;
  /** Ask the public status page; restarts the assistant server. */
  statusPage: boolean;
  startNode: MCPMode;
  // Requests: ask lets assistants ask (each request approved), block stops them
  stopNode: MCPMode;
  settings: MCPMode;
  newAccounts: MCPMode;
  watchOnly: MCPMode;
  editContacts: MCPMode;
  sendTransactions: MCPMode;
};

/** A send an assistant asks for, as quoted when it asked. Amounts are decimal wei. */
export type TxProposal = {
  from: string;
  fromName: string;
  /** From a watch-only account: approving makes a signing request for the offline signer. */
  watchOnly: boolean;
  to: string;
  /** Who the address is to the wallet: one of its accounts, a contact, or never seen. */
  recipient: "own" | "contact" | "new";
  toName?: string;
  toContract: boolean;
  valueWei: string;
  gasPriceWei: string;
  gasLimit: number;
  feeWei: string;
  totalWei: string;
  balanceWei: string;
};

/** One setting an assistant asks to change, values as JSON. */
export type SettingChange = {
  key: string;
  label: string;
  from: unknown;
  to: unknown;
  /** When it takes effect: now, on the node's restart, or on the app's. */
  applies: "now" | "node" | "app";
  /** Opens the node to other programs, or shares something about it. */
  sensitive: boolean;
};

/** Something an AI assistant asked the app to do, waiting on the user. */
export type AssistantRequest = {
  id: string;
  kind: "stopNode" | "settings" | "newAccount" | "watchOnly" | "contact" | "transaction" | "permission";
  /** The assistant's own words: shown as theirs, never the app's. */
  reason: string;
  created: number;
  expires: number;
  status: "pending" | "approved" | "rejected" | "expired" | "failed";
  result: string;
  changes?: SettingChange[];
  account?: { name: string; seedId?: string; seedName?: string };
  watch?: { name: string; address: string };
  contact?: { id?: string; name: string; address: string; note: string; previous?: Contact };
  transaction?: TxProposal;
  /** A permission prompt: the feature a tool needs, and the tool. */
  permission?: {
    feature: keyof MCPAllow;
    tool: string;
    /** Asked to start the node a tool needs. */ nodeStopped?: boolean;
  };
};

/** The AI assistant (MCP) server, and how to connect to it. */
export type MCPStatus = {
  enabled: boolean;
  running: boolean;
  /** Where assistants connect, while enabled. */
  url: string;
  /** The bearer token assistants send, while enabled. */
  token: string;
  /** Why it isn't running, such as its port being taken. */
  error: string;
  tools: string[] | null;
  /** The assistants connected now, as they name themselves ("Claude Code"), one per connection. */
  clients: string[] | null;
};

/** A tool call an assistant is making now, as the assistant bar shows it at work. */
export type MCPActivity = {
  tool: string;
  client: string;
  /** The block a wait_for_new_block call waits for, when it names one. */
  block?: number;
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

  mcpStatus: () => call<MCPStatus>("MCPStatus"),
  mcpResetToken: () => call<MCPStatus>("MCPResetToken"),
  /** Stops the tool call the assistant bar shows; the assistant is told the user cancelled it. */
  mcpCancel: () => call<boolean>("MCPCancel"),
  assistantRequests: () => call<AssistantRequest[]>("AssistantRequests"),
  /** password is the wallet's, for a request that makes an account. */
  assistantApprove: (id: string, password: string) => call<AssistantRequest>("AssistantApprove", id, password),
  assistantReject: (id: string) => call<void>("AssistantReject", id),
  /** Answers a permission prompt: once (this assistant's connection) or always. */
  assistantAllow: (id: string, always: boolean) => call<AssistantRequest>("AssistantAllow", id, always),

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

  // Wallet. The password travels to the backend only: to unlock the wallet,
  // which keeps it for the actions that sign or add keys until it locks
  // (backend/session.go), and for the few that ask for it again
  walletInfo: () => call<WalletInfo>("WalletInfo"),
  walletUnlock: (password: string) => call<void>("WalletUnlock", password),
  walletLock: () => call<void>("WalletLock"),
  /** The user is at the app: puts off the auto-lock. */
  walletTouch: () => call<void>("WalletTouch"),
  walletSelect: (address: string) => call<void>("WalletSelect", address),
  walletRename: (address: string, name: string) => call<void>("WalletRename", address, name),
  walletCreate: (name: string) => call<WalletAccount>("WalletCreate", name),
  walletImportPrivateKey: (name: string, key: string) => call<WalletAccount>("WalletImportPrivateKey", name, key),
  /** filePassword is the keystore file's own. */
  walletImportKeyfile: (name: string, keyJSON: string, filePassword: string) =>
    call<WalletAccount>("WalletImportKeyfile", name, keyJSON, filePassword),
  walletSetupPassword: (password: string) => call<void>("WalletSetupPassword", password),
  walletChangePassword: (oldPassword: string, newPassword: string) =>
    call<void>("WalletChangePassword", oldPassword, newPassword),
  walletCreateSeed: (name: string, passphrase: string) => call<SeedPhrase>("WalletCreateSeed", name, passphrase),
  walletNewSeedWords: (count: 12 | 24) => call<string[]>("WalletNewSeedWords", count),
  walletCreateSeedWords: (name: string, words: string, passphrase: string, confirmed: boolean) =>
    call<WalletAccount>("WalletCreateSeedWords", name, words, passphrase, confirmed),
  walletScanSeed: (words: string, passphrase: string, scheme: SeedScheme, from: number, count: number) =>
    call<SeedCandidate[]>("WalletScanSeed", words, passphrase, scheme, from, count),
  walletImportSeed: (name: string, words: string, passphrase: string, picks: SeedPick[]) =>
    call<WalletAccount>("WalletImportSeed", name, words, passphrase, picks),
  walletScanWalletSeed: (seedId: string, scheme: SeedScheme, from: number, count: number) =>
    call<SeedCandidate[]>("WalletScanWalletSeed", seedId, scheme, from, count),
  walletAddSeedAccounts: (seedId: string, picks: SeedPick[]) =>
    call<WalletAccount>("WalletAddSeedAccounts", seedId, picks),
  walletDeriveAccount: (seedId: string, name: string) => call<WalletAccount>("WalletDeriveAccount", seedId, name),
  walletRevealSeed: (seedId: string, password: string) => call<SeedPhrase>("WalletRevealSeed", seedId, password),
  walletConfirmSeed: (seedId: string) => call<void>("WalletConfirmSeed", seedId),
  walletRenameSeed: (seedId: string, name: string) => call<void>("WalletRenameSeed", seedId, name),
  walletRemoveSeed: (seedId: string, password: string) => call<void>("WalletRemoveSeed", seedId, password),
  walletBackup: (address: string) => call<WalletBackup>("WalletBackup", address),
  walletMarkBackedUp: (address: string) => call<void>("WalletMarkBackedUp", address),
  walletRemove: (address: string, password: string) => call<void>("WalletRemove", address, password),
  walletSummary: (address: string) => call<AddressView>("WalletSummary", address),
  /** Every wallet account's balance at the head, in wei by checksummed address. */
  walletBalances: () => call<Record<string, string>>("WalletBalances"),
  walletAddWatchOnly: (name: string, address: string) => call<WalletAccount>("WalletAddWatchOnly", name, address),
  walletRemoveWatchOnly: (address: string) => call<void>("WalletRemoveWatchOnly", address),
  offlineBuildRequest: (input: OfflineRequestInput) => call<SigningRequest>("OfflineBuildRequest", input),
  offlinePendingRequests: () => call<PendingRequest[]>("OfflinePendingRequests"),
  offlineDiscardRequest: (id: string) => call<void>("OfflineDiscardRequest", id),
  offlineReplaceRequest: (id: string) => call<SigningRequest>("OfflineReplaceRequest", id),
  offlineReviewSigned: (data: string) => call<SignedReview>("OfflineReviewSigned", data),
  offlineBroadcast: (data: string) => call<SentTx>("OfflineBroadcast", data),
  offlineReviewRequest: (data: string) => call<RequestReview>("OfflineReviewRequest", data),
  offlineSignRequest: (data: string) => call<SignedOffline>("OfflineSignRequest", data),
  messageSign: (address: string, message: string) => call<SignedMessage>("MessageSign", address, message),
  messageVerify: (address: string, message: string, signature: string) =>
    call<MessageCheck>("MessageVerify", address, message, signature),
  messageBuildRequest: (address: string, message: string) =>
    call<MessageRequest>("MessageBuildRequest", address, message),
  messageReviewRequest: (data: string) => call<MessageRequest>("MessageReviewRequest", data),
  messageSignRequest: (data: string) => call<SignedMessage>("MessageSignRequest", data),
  messageReviewSigned: (data: string) => call<SignedMessage & MessageCheck>("MessageReviewSigned", data),
  contacts: () => call<Contact[]>("Contacts"),
  contactAdd: (c: ContactInput) => call<Contact>("ContactAdd", c),
  contactUpdate: (id: string, c: ContactInput) => call<Contact>("ContactUpdate", id, c),
  contactSetFavorite: (id: string, on: boolean) => call<void>("ContactSetFavorite", id, on),
  contactRemove: (id: string) => call<void>("ContactRemove", id),
  contactsExport: (format: "json" | "csv") => call<string>("ContactsExport", format),
  contactsImport: (data: string) => call<ContactsImport>("ContactsImport", data),
  /** The development profile this copy runs as (make dev PROFILE=…), "" for the default one. */
  profile: () => call<string>("Profile"),
  txDetails: (hash: string) => call<TxDetails>("TxDetails", hash),
  walletActivitySince: (after: number) =>
    call<{ transactions: WalletTx[]; head: number }>("WalletActivitySince", after),
  walletQuote: (from: string, to: string, valueWei: string, gasPriceWei: string) =>
    call<SendQuote>("WalletQuote", from, to, valueWei, gasPriceWei),
  walletSend: (req: SendRequest) => call<SentTx>("WalletSend", req),
  walletQuoteReplace: (from: string, hash: string, kind: ReplaceKind) =>
    call<ReplaceQuote>("WalletQuoteReplace", from, hash, kind),
  walletReplace: (req: ReplaceRequest) => call<SentTx>("WalletReplace", req),
  /** Holds the development chain's blocks back, or lets it seal again (make dev only). */
  devSetHold: (hold: boolean) => call<void>("DevSetHold", hold),

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
