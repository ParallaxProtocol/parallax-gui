// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

// GUIVersion is the user-facing version of the desktop app.
var GUIVersion = "0.1.0"

// GUIConfig is the persisted configuration that the wizard / settings screens
// edit. It is intentionally a flat struct so that it serialises to JSON
// without surprises.
type GUIConfig struct {
	Bootstrapped   bool   `json:"bootstrapped"`
	DataDir        string `json:"dataDir"`
	SyncMode       string `json:"syncMode"` // "snap" | "full"
	HTTPRPCEnabled bool   `json:"httpRpcEnabled"`
	HTTPRPCPort    int    `json:"httpRpcPort"`
	// BlockInbound, when true, disables NAT traversal so peers cannot dial
	// us. Stored as the negative ("block") so that the JSON zero value
	// (false = allow inbound) is the safe network-friendly default for
	// configs persisted before this field existed.
	BlockInbound  bool   `json:"blockInbound"`
	MaxPeers      int    `json:"maxPeers"`
	Theme         string `json:"theme"` // "system" | "light" | "dark"
	AutoStartNode bool   `json:"autoStartNode"`
	// DisableAnimations turns off CSS keyframes, motion/react transitions
	// and any decorative motion in the GUI. Useful on low-power systems
	// or for users who find the rolling figures and transitions distracting.
	DisableAnimations bool `json:"disableAnimations"`

	// EnableSmartFee turns on the Bitcoin Core-style smart fee estimator
	// in the gas-price oracle (fees.Config.EnableSmartFeeEstimator).
	// On by default for fresh installs — same default as the v2.0.0 CLI's
	// --gpo.smartfee flag. Requires a node restart to take effect because
	// the oracle is built once at protocol.New() time.
	EnableSmartFee bool `json:"enableSmartFee"`

	// ReportStats registers the prlstats service so the node reports its
	// status (block height, peer count, sync/mining state, client version,
	// OS) to the public dashboard at status.parallaxprotocol.org under a
	// random name kept in the datadir — the same as a bare --prlstats on the
	// CLI. Offered on by default in the onboarding wizard; configs persisted
	// before this field existed load it as false, so existing installs are
	// never opted in silently. Requires a node restart: the service is
	// registered before stack.Start().
	ReportStats bool `json:"reportStats"`

	// Advanced (only meaningful when AdvancedUnlocked is true in the UI).
	DatabaseCacheMB  int `json:"databaseCacheMB"`
	TrieCleanCacheMB int `json:"trieCleanCacheMB"`
	TrieDirtyCacheMB int `json:"trieDirtyCacheMB"`
	SnapshotCacheMB  int `json:"snapshotCacheMB"`

	// Mining
	MiningWallet  string     `json:"miningWallet"`  // 0x... reward address
	MiningWorker  string     `json:"miningWorker"`  // worker name (defaults to hostname)
	MiningPool    string     `json:"miningPool"`    // selected pool URL
	MiningThreads int        `json:"miningThreads"` // CPU threads for solo mode (0 = auto)
	MiningDevices []int      `json:"miningDevices"` // GPU device indices (nil = all)
	CustomPools   []PoolInfo `json:"customPools"`   // user-added pool entries

	// WatchAddress is the address the Wallet page follows (balance, mined
	// blocks, transactions). Empty means it follows MiningWallet.
	WatchAddress string `json:"watchAddress"`

	// StaticPeers and TrustedPeers are enode URLs the user added from the
	// peer list, re-applied at every node start: the daemon keeps neither
	// across restarts on its own. (Peers added by ip:port need no entry
	// here: the daemon's address book keeps those.)
	StaticPeers  []string `json:"staticPeers"`
	TrustedPeers []string `json:"trustedPeers"`

	// The fields below mirror parallaxd's command-line flags, each named
	// after its flag. An empty string, nil pointer or false keeps the CLI's
	// default, so configs saved before a field existed behave exactly like
	// a bare `parallaxd`. Pointers are used where 0 is a meaningful value
	// of its own (0 = unlimited, 0 = disabled).

	// Node
	NodeName      string  `json:"nodeName"`      // --identity
	ArchiveMode   bool    `json:"archiveMode"`   // --gcmode archive
	TxLookupLimit *uint64 `json:"txLookupLimit"` // --txlookuplimit (0 = whole chain)
	NoSnapshot    bool    `json:"noSnapshot"`    // --snapshot=false (ignored under snap sync)
	AncientDir    string  `json:"ancientDir"`    // --datadir.ancient
	MinFreeDiskMB *int    `json:"minFreeDiskMB"` // --datadir.minfreedisk (0 = never stop)
	FDLimit       int     `json:"fdLimit"`       // --fdlimit (0 = the OS limit)
	NoPrefetch    bool    `json:"noPrefetch"`    // --cache.noprefetch
	Preimages     bool    `json:"preimages"`     // --cache.preimages

	// Network
	ListenPort      int      `json:"listenPort"`      // --port
	NATMode         string   `json:"natMode"`         // --nat: "" (any) | "upnp" | "pmp" | "extip"; BlockInbound means none
	ExternalIP      string   `json:"externalIp"`      // the address for --nat extip:<IP>
	MaxPendingPeers int      `json:"maxPendingPeers"` // --maxpendpeers (0 = default)
	NoDiscovery     bool     `json:"noDiscovery"`     // --nodiscover
	LegacyDiscovery string   `json:"legacyDiscovery"` // --legacy-discovery: "" (auto) | "on" | "off"
	NetRestrict     string   `json:"netRestrict"`     // --netrestrict, comma-separated CIDR masks
	Bootnodes       []string `json:"bootnodes"`       // --bootnodes, enode URLs or ip:port (empty = built-in)

	// Privacy (PIP-0007)
	Proxy            string   `json:"proxy"`            // --proxy, SOCKS5 ip:port
	OnionProxy       string   `json:"onionProxy"`       // --onion ("0" = no onion outbound)
	OnlyNet          []string `json:"onlyNet"`          // --onlynet: ipv4 | ipv6 | onion
	ProxyNoRandomize bool     `json:"proxyNoRandomize"` // --proxyrandomize=false
	NoListenOnion    bool     `json:"noListenOnion"`    // --listenonion=false
	TorControl       string   `json:"torControl"`       // --torcontrol
	TorPassword      string   `json:"torPassword"`      // --torpassword

	// RPC
	HTTPHost            string   `json:"httpHost"`            // --http.addr (empty = 127.0.0.1)
	HTTPAPIs            []string `json:"httpApis"`            // --http.api (empty = net, web3, eth, debug)
	HTTPCors            []string `json:"httpCors"`            // --http.corsdomain (empty = *)
	HTTPVirtualHosts    []string `json:"httpVhosts"`          // --http.vhosts (empty = localhost, 127.0.0.1)
	WSEnabled           bool     `json:"wsEnabled"`           // --ws
	WSHost              string   `json:"wsHost"`              // --ws.addr (empty = 127.0.0.1)
	WSPort              int      `json:"wsPort"`              // --ws.port (0 = 8546)
	WSAPIs              []string `json:"wsApis"`              // --ws.api (empty = net, web3, eth, debug)
	WSOrigins           []string `json:"wsOrigins"`           // --ws.origins (empty = *)
	GraphQL             bool     `json:"graphql"`             // --graphql
	IPCDisabled         bool     `json:"ipcDisabled"`         // --ipcdisable
	RPCGasCap           *uint64  `json:"rpcGasCap"`           // --rpc.gascap (0 = no cap)
	RPCTxFeeCap         *float64 `json:"rpcTxFeeCap"`         // --rpc.txfeecap, in LAX (0 = no cap)
	RPCPVMTimeoutSec    *int     `json:"rpcPvmTimeoutSec"`    // --rpc.pvmtimeout (0 = no timeout)
	RPCLogQueryLimit    *int     `json:"rpcLogQueryLimit"`    // --rpc.logquerylimit (0 = no limit)
	RPCBatchLimit       *int     `json:"rpcBatchLimit"`       // --rpc.batch-request-limit
	AllowUnprotectedTxs bool     `json:"allowUnprotectedTxs"` // --rpc.allow-unprotected-txs

	// Transaction pool
	TxPoolLocals       []string `json:"txPoolLocals"`       // --txpool.locals
	TxPoolNoLocals     bool     `json:"txPoolNoLocals"`     // --txpool.nolocals
	TxPoolPriceLimit   *uint64  `json:"txPoolPriceLimit"`   // --txpool.pricelimit, in wei
	TxPoolPriceBump    *uint64  `json:"txPoolPriceBump"`    // --txpool.pricebump, in percent
	TxPoolAccountSlots *uint64  `json:"txPoolAccountSlots"` // --txpool.accountslots
	TxPoolGlobalSlots  *uint64  `json:"txPoolGlobalSlots"`  // --txpool.globalslots
	TxPoolAccountQueue *uint64  `json:"txPoolAccountQueue"` // --txpool.accountqueue
	TxPoolGlobalQueue  *uint64  `json:"txPoolGlobalQueue"`  // --txpool.globalqueue
	TxPoolLifetimeMin  *int     `json:"txPoolLifetimeMin"`  // --txpool.lifetime, in minutes

	// Gas price oracle
	GPOBlocks      *int   `json:"gpoBlocks"`      // --gpo.blocks
	GPOPercentile  *int   `json:"gpoPercentile"`  // --gpo.percentile
	GPOMaxPrice    string `json:"gpoMaxPrice"`    // --gpo.maxprice, decimal wei
	GPOIgnorePrice string `json:"gpoIgnorePrice"` // --gpo.ignoreprice, decimal wei

	// Mining with the node's own miner (solo modes)
	MinerExtraData   string `json:"minerExtraData"`   // --miner.extradata
	MinerGasLimit    uint64 `json:"minerGasLimit"`    // --miner.gaslimit (0 = default)
	MinerGasPrice    string `json:"minerGasPrice"`    // --miner.gasprice, decimal wei
	MinerRecommitSec int    `json:"minerRecommitSec"` // --miner.recommit (0 = default)

	// Metrics. The daemon decides whether metrics are collected once, at
	// process start, from its argv (support/metrics init), so these take
	// effect on the next launch of the app: the shell passes --metrics and
	// --metrics.expensive to the backend when they are on.
	Metrics          bool   `json:"metrics"`          // --metrics
	MetricsExpensive bool   `json:"metricsExpensive"` // --metrics.expensive
	MetricsAddr      string `json:"metricsAddr"`      // --metrics.addr (empty = no HTTP endpoint)
	MetricsPort      int    `json:"metricsPort"`      // --metrics.port (0 = 6060)

	// Desktop
	LogLevel       int    `json:"logLevel"`       // --verbosity, 1 (error) to 5 (trace); 0 = info
	NoUpdateCheck  bool   `json:"noUpdateCheck"`  // don't look for new releases in the background
	PreventSleep   bool   `json:"preventSleep"`   // keep the computer awake while mining or syncing
	Notifications  bool   `json:"notifications"`  // desktop notifications: sync done, block found, node stopped
	ResumeMining   bool   `json:"resumeMining"`   // restart mining at launch if it was running at quit
	LastMiningMode string `json:"lastMiningMode"` // the mode mining was last started in; empty once the user stops it
}

// NodeDetails is the Overview's fuller picture of the running node: who it
// is, how the network reaches it, the chain and mempool as it sees them,
// and its storage. It costs more than NodeStatus (a fee estimate, a free
// space reading), so the frontend polls it less often. Zero-valued while
// the node is stopped. Amounts are decimal wei strings.
type NodeDetails struct {
	Running bool `json:"running"`

	// Identity
	NodeID        string `json:"nodeId"`
	Enode         string `json:"enode"` // empty in v2-only mode, where no persistent identity is dialable
	ClientName    string `json:"clientName"`
	DaemonVersion string `json:"daemonVersion"`

	// Network
	ExternalIP     string `json:"externalIp"`
	ListenPort     int    `json:"listenPort"`
	InboundAllowed bool   `json:"inboundAllowed"`
	MaxPeers       int    `json:"maxPeers"`
	V2Only         bool   `json:"v2Only"` // the legacy (v1) handshake is refused

	// Chain
	TotalDifficulty  string `json:"totalDifficulty"`
	BlockRewardWei   string `json:"blockRewardWei"`
	NextHalvingBlock uint64 `json:"nextHalvingBlock"`
	BlocksToHalving  uint64 `json:"blocksToHalving"`

	// Mempool and fees
	TxPending        int    `json:"txPending"`
	TxQueued         int    `json:"txQueued"`
	TxBytes          uint64 `json:"txBytes"`          // the pool's size: its transactions' encoded bytes
	GasPriceWei      string `json:"gasPriceWei"`      // what eth_gasPrice would suggest now
	SmartFee         bool   `json:"smartFee"`         // the smart fee estimator is on
	SmartFeeWei      string `json:"smartFeeWei"`      // its estimate for SmartFeeTarget blocks; empty while it has none
	SmartFeeTarget   int    `json:"smartFeeTarget"`   // the confirmation target asked of it, in blocks
	SmartFeeBlocks   int    `json:"smartFeeBlocks"`   // blocks of data it has gathered: its warm-up
	SmartFeeFallback bool   `json:"smartFeeFallback"` // the estimate came from the legacy oracle

	// Storage
	DiskFreeBytes      uint64 `json:"diskFreeBytes"`
	DiskStopBelowBytes uint64 `json:"diskStopBelowBytes"` // the node stops itself below this much free space

	// Sync
	SyncModeConfigured string `json:"syncModeConfigured"`
	SyncModeActive     string `json:"syncModeActive"`
	ArchiveMode        bool   `json:"archiveMode"`
	SnapAccounts       uint64 `json:"snapAccounts"` // snap sync's state download, while it runs
	SnapStorage        uint64 `json:"snapStorage"`
	SnapBytes          uint64 `json:"snapBytes"`
	SnapHealing        uint64 `json:"snapHealing"` // trie nodes still to heal

	// Public status page
	StatsName string `json:"statsName"` // empty unless reporting
	StatsHost string `json:"statsHost"`
}

// NodeStatus is the high-level snapshot the dashboard polls.
type NodeStatus struct {
	Running       bool   `json:"running"`
	Syncing       bool   `json:"syncing"`
	CurrentBlock  uint64 `json:"currentBlock"`
	HighestBlock  uint64 `json:"highestBlock"`
	StartingBlock uint64 `json:"startingBlock"`
	Peers         int    `json:"peers"`
	ChainID       uint64 `json:"chainId"`
	NetworkID     uint64 `json:"networkId"`
	DataDir       string `json:"dataDir"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
	DiskUsedBytes uint64 `json:"diskUsedBytes"`
	MemUsedBytes  uint64 `json:"memUsedBytes"`
	ClientVersion string `json:"clientVersion"`
	RPCEndpoint   string `json:"rpcEndpoint"` // empty if HTTP-RPC disabled
}

// NodeEvent is broadcast as the "node" event.
type NodeEvent struct {
	Kind    string      `json:"kind"`
	Payload interface{} `json:"payload,omitempty"`
}

// LogLine is one tailed log entry streamed to the frontend.
type LogLine struct {
	Timestamp int64  `json:"ts"`
	Level     string `json:"level"`
	Message   string `json:"msg"`
}

// PeerView is one row of the dashboard's peer list.
//
// The dashboard's compact view uses ID, Name, RemoteAddr, Inbound, Caps.
// The full Peers screen additionally consumes FullID, Enode, LocalAddr,
// Address, Network, MinPingMs, Trusted, Static, and Protocols
// (per-subprotocol metadata such as the peer's head hash and total
// difficulty for the prl protocol).
type PeerView struct {
	ID         string                 `json:"id"`     // 8-char short id
	FullID     string                 `json:"fullId"` // full hex node id
	Enode      string                 `json:"enode"`  // full enode:// URL
	Name       string                 `json:"name"`
	RemoteAddr string                 `json:"remoteAddr"`
	LocalAddr  string                 `json:"localAddr"`
	Address    string                 `json:"address,omitempty"` // dial target; empty for inbound
	Network    string                 `json:"network"`           // "ipv4" | "ipv6" | "onion"
	MinPingMs  float64                `json:"minPingMs,omitempty"`
	Inbound    bool                   `json:"inbound"`
	Trusted    bool                   `json:"trusted"`
	Static     bool                   `json:"static"`
	Caps       []string               `json:"caps"`
	Protocols  map[string]interface{} `json:"protocols,omitempty"`
}

// TxView is one row of the dashboard's recent-transactions table.
type TxView struct {
	Hash      string `json:"hash"`
	Block     uint64 `json:"block"`
	Timestamp int64  `json:"timestamp"`
	From      string `json:"from"`
	To        string `json:"to"` // empty for contract creation
	ValueWei  string `json:"valueWei"`
	GasUsed   uint64 `json:"gasUsed"` // gas the tx requested (limit)
	Kind      string `json:"kind"`    // "transfer" | "contract" | "call"
}

// BlockView is one row of the dashboard's recent-blocks table.
type BlockView struct {
	Number     uint64 `json:"number"`
	Hash       string `json:"hash"`
	Timestamp  int64  `json:"timestamp"`
	TxCount    int    `json:"txCount"`
	GasUsed    uint64 `json:"gasUsed"`
	GasLimit   uint64 `json:"gasLimit"`
	SizeBytes  uint64 `json:"sizeBytes"`
	Coinbase   string `json:"coinbase"`
	RewardWei  string `json:"rewardWei"` // base subsidy for this height
	Difficulty string `json:"difficulty"`
}

// AddressView summarises one watched address for the Wallet page: its
// balance at the head, and what the recent chain holds for it.
type AddressView struct {
	Address string `json:"address"`
	// BalanceWei is empty while the head state is unavailable (e.g. during
	// snap sync, before the state download completes).
	BalanceWei string `json:"balanceWei"`
	Nonce      uint64 `json:"nonce"`
	HeadBlock  uint64 `json:"headBlock"`
	// ScannedFrom is the oldest block the activity below was gathered from.
	ScannedFrom  uint64      `json:"scannedFrom"`
	BlocksMined  int         `json:"blocksMined"`  // blocks in the window with this coinbase
	MinedWei     string      `json:"minedWei"`     // their base subsidy
	MinedBlocks  []BlockView `json:"minedBlocks"`  // newest first, capped
	Transactions []TxView    `json:"transactions"` // newest first, capped
}

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------

// PoolInfo describes one mining pool endpoint.
type PoolInfo struct {
	Name    string `json:"name"`
	URL     string `json:"url"`     // stratum+tcp://host:port
	Region  string `json:"region"`  // "US", "EU", "Asia", etc.
	Builtin bool   `json:"builtin"` // true = shipped with app
}

// DeviceInfo describes one GPU detected by hashwarp --list-devices.
type DeviceInfo struct {
	Index  int    `json:"index"`
	PciID  string `json:"pciId"` // "01:00.0"
	Type   string `json:"type"`  // "Gpu" | "Cpu" | "Acc"
	Name   string `json:"name"`
	Memory string `json:"memory"` // "8.00 GB"
	CUDA   bool   `json:"cuda"`
	OpenCL bool   `json:"openCl"`
}

// GPUDeviceStatus is per-device live stats from hashwarp API.
type GPUDeviceStatus struct {
	Index    int     `json:"index"`
	Name     string  `json:"name"`
	Mode     string  `json:"mode"` // "CUDA" | "OpenCL"
	Hashrate float64 `json:"hashrate"`
	TempC    int     `json:"tempC"`
	FanPct   int     `json:"fanPct"`
	PowerW   float64 `json:"powerW"`
	Paused   bool    `json:"paused"`
	Accepted uint64  `json:"accepted"`
	Rejected uint64  `json:"rejected"`
	Failed   uint64  `json:"failed"`
}

// MinerStatus is the unified snapshot polled by Mining.tsx every 2s.
type MinerStatus struct {
	Mode    string `json:"mode"` // "off" | "pool" | "solo"
	Running bool   `json:"running"`

	// Aggregate
	Hashrate      float64 `json:"hashrate"` // H/s
	UptimeSeconds int64   `json:"uptimeSeconds"`

	// Pool mode (GPU via hashwarp)
	PoolConnected      bool              `json:"poolConnected"`
	PoolURI            string            `json:"poolUri"`
	SharesAccepted     uint64            `json:"sharesAccepted"`
	SharesRejected     uint64            `json:"sharesRejected"`
	SharesFailed       uint64            `json:"sharesFailed"`
	SecsSinceLastShare uint64            `json:"secsSinceLastShare"`
	Epoch              int               `json:"epoch"`
	GeneratingDAG      bool              `json:"generatingDag"`
	Devices            []GPUDeviceStatus `json:"devices"`

	// Solo mode (CPU via embedded node)
	SoloDifficulty  string `json:"soloDifficulty"`
	SoloBlocksFound uint64 `json:"soloBlocksFound"`

	// Error surfaced to UI
	Error string `json:"error,omitempty"`
}

// MinerEvent is broadcast as the "miner" event.
type MinerEvent struct {
	Kind    string      `json:"kind"` // "started" | "stopped" | "error" | "dag" | "stats"
	Payload interface{} `json:"payload,omitempty"`
}

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

// UpdateInfo describes an available update found on GitHub Releases.
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseURL"` // HTML URL for "View release notes"
	AssetURL       string `json:"assetURL"`   // download URL for this OS/arch
	AssetName      string `json:"assetName"`
	AssetSize      int64  `json:"assetSize"` // bytes
	PublishedAt    string `json:"publishedAt"`
}

// UpdateProgress is broadcast as the "update-progress" event.
type UpdateProgress struct {
	// Step is one of:
	//   downloading | verifying | extracting | ready | ready-manual | error
	//
	// "ready" means the new binary is staged in place and the app can be
	// restarted automatically. "ready-manual" means the artifact has been
	// opened (e.g. macOS DMG mounted in Finder) and the user has to finish
	// the install themselves.
	Step    string `json:"step"`
	Percent int    `json:"percent"` // 0-100 for downloading
	Detail  string `json:"detail"`
}
