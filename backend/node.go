// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	parallaxpkg "github.com/ParallaxProtocol/parallax/v2"
	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/kernel/xhash"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/node"
	protocol "github.com/ParallaxProtocol/parallax/v2/node/fullnode"
	"github.com/ParallaxProtocol/parallax/v2/node/fullnode/downloader"
	"github.com/ParallaxProtocol/parallax/v2/node/fullnode/tracers"
	"github.com/ParallaxProtocol/parallax/v2/node/nodeconfig"
	"github.com/ParallaxProtocol/parallax/v2/node/stats"
	"github.com/ParallaxProtocol/parallax/v2/p2p/addrman"
	"github.com/ParallaxProtocol/parallax/v2/p2p/enode"
	"github.com/ParallaxProtocol/parallax/v2/p2p/netparams"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/rpc/graphql"
	"github.com/ParallaxProtocol/parallax/v2/support/metrics"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// NodeController owns the embedded node.Node + protocol.Parallax instance and
// drives its lifecycle from the GUI. It is safe for concurrent use.
type NodeController struct {
	cfg *ConfigStore

	mu        sync.RWMutex
	stack     *node.Node
	parallax  *protocol.Parallax
	startedAt time.Time
	stopCh    chan struct{} // closed by Stop() so background goroutines exit
	dev       bool          // running the development chain (devchain.go)
	// The free space below which monitorFreeDiskSpace stops the node; 0 when off
	diskCritical uint64

	emitter func(NodeEvent)

	// The data directory's size, re-measured at most every diskUsageTTL:
	// walking a multi-gigabyte chain database on every status poll is
	// far too slow.
	diskMu     sync.Mutex
	diskDir    string
	diskBytes  uint64
	diskReadAt time.Time
}

const diskUsageTTL = 30 * time.Second

// diskUsage returns the cached size of dir, measuring it again once the
// cached reading is older than diskUsageTTL or was for another directory.
func (n *NodeController) diskUsage(dir string) uint64 {
	n.diskMu.Lock()
	defer n.diskMu.Unlock()
	if dir != n.diskDir || time.Since(n.diskReadAt) > diskUsageTTL {
		n.diskDir = dir
		n.diskBytes = directorySize(dir)
		n.diskReadAt = time.Now()
	}
	return n.diskBytes
}

// processMetricsOnce ensures we only ever spawn metrics.CollectProcessMetrics
// a single time per process. Like the CLI, the collector is an infinite
// goroutine and is shared across node restarts.
var processMetricsOnce sync.Once

// NewNodeController creates a controller. Nothing is started until Start is
// called.
func NewNodeController(cfg *ConfigStore) *NodeController {
	return &NodeController{cfg: cfg}
}

// SetEmitter installs an event sink. Pass nil to disable.
func (n *NodeController) SetEmitter(fn func(NodeEvent)) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.emitter = fn
}

func (n *NodeController) emit(kind string, payload interface{}) {
	n.mu.RLock()
	fn := n.emitter
	n.mu.RUnlock()
	if fn != nil {
		fn(NodeEvent{Kind: kind, Payload: payload})
	}
}

// Parallax returns the running prl backend, or nil if the node is stopped.
// Other backend services use this to read chain state directly.
func (n *NodeController) Parallax() *protocol.Parallax {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.parallax
}

// Stack returns the underlying node.Node, or nil if stopped.
func (n *NodeController) Stack() *node.Node {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.stack
}

// Start brings up the in-process node. It is idempotent: calling Start while
// already running returns nil.
//
// The startup sequence mirrors cmd/parallaxd so the embedded node behaves like a
// first-class CLI install:
//
//  1. node.New(cfg)
//  2. attach a keystore backend (so AccountManager has at least one backend)
//  3. protocol.New(stack, cfg) — registers the prl service
//  4. stack.RegisterAPIs(tracers.APIs(...)) — debug_* tracer namespace
//  5. stats.New(...) — prlstats reporting, when enabled in the config
//  6. stack.Start()
//  7. spawn process metrics collector (once per process)
//  8. spawn the free-disk-space monitor (per Start, stops on Stop)
//  9. log a one-time legacy receipts warning if the freezer needs migration
func (n *NodeController) Start(ctx context.Context) error {
	n.mu.Lock()
	if n.stack != nil {
		n.mu.Unlock()
		return nil
	}
	guiCfg := n.cfg.Get()
	n.mu.Unlock()
	// An offline signer never goes online, whoever asks
	if guiCfg.OfflineSigner {
		return ErrOfflineSigner
	}

	nodeCfg, prlCfg, err := buildConfigs(guiCfg)
	if err != nil {
		return err
	}
	prlCfg.DatabaseHandles = tuneProcess(guiCfg, &prlCfg)

	stack, err := node.New(&nodeCfg)
	if err != nil {
		return fmt.Errorf("create node: %w", err)
	}
	ks := setAccountManagerBackends(stack)
	dev := devChain(guiCfg)
	if dev {
		if err := prepareDevChain(stack, ks, guiCfg, &prlCfg); err != nil {
			stack.Close()
			return err
		}
	}

	parallax, err := protocol.New(stack, &prlCfg)
	if err != nil {
		stack.Close()
		return fmt.Errorf("register parallax service: %w", err)
	}

	// Register the debug tracer namespace. The CLI does this in
	// cmd/utils/flags.go RegisterParallaxService — without it,
	// debug_traceTransaction / debug_traceCall etc. silently 404 over RPC,
	// which breaks devtools and dapp debuggers connecting to our local node.
	stack.RegisterAPIs(tracers.APIs(parallax.APIBackend))

	// --graphql: served by the HTTP-RPC server at /graphql
	if guiCfg.GraphQL {
		if err := graphql.New(stack, parallax.APIBackend, nodeCfg.GraphQLCors, nodeCfg.GraphQLVirtualHosts); err != nil {
			stack.Close()
			return fmt.Errorf("register GraphQL service: %w", err)
		}
	}

	// Public stats reporting, the GUI's equivalent of a bare --prlstats
	// (cmd/utils RegisterPrlStatsService). A failure here only costs the
	// dashboard entry, so log it instead of refusing to start the node.
	if guiCfg.ReportStats && !dev {
		if err := stats.New(stack, parallax.APIBackend, parallax.Engine(), stats.DefaultHost); err != nil {
			logging.Warn("Failed to register the Parallax Stats service", "err", err)
		}
	}

	if err := stack.Start(); err != nil {
		stack.Close()
		return fmt.Errorf("start node: %w", err)
	}

	stopCh := make(chan struct{})
	n.mu.Lock()
	n.stack = stack
	n.parallax = parallax
	n.startedAt = time.Now()
	n.stopCh = stopCh
	n.dev = dev
	n.mu.Unlock()

	// The development chain seals a block for each transaction, as
	// `parallaxd --dev` does
	if dev {
		if err := parallax.StartMining(1); err != nil {
			logging.Error("Failed to start sealing the development chain", "err", err)
		}
	}

	// Process metrics: cmd/parallaxd calls this exactly once in prepare(). It
	// runs forever, so we wrap it in sync.Once and let restarts share the
	// single collector.
	processMetricsOnce.Do(func() {
		go metrics.CollectProcessMetrics(3 * time.Second)
	})

	// Free disk space monitor: triggers a graceful Stop() when free space
	// on the data directory crosses below the critical threshold, matching
	// the safeguard cmd/utils/cmd.go installs in StartNode.
	critical := minFreeDiskBytes(guiCfg, &prlCfg)
	n.mu.Lock()
	n.diskCritical = critical
	n.mu.Unlock()
	if critical > 0 {
		go n.monitorFreeDiskSpace(stack.InstanceDir(), critical, stopCh)
	}

	// Legacy receipts warning. This is purely informational — the chain
	// will run with legacy receipts, but `parallaxd db freezer-migrate` is the
	// recommended path forward. We log it once at startup to mirror the
	// CLI's behaviour at cmd/parallaxd/config.go.
	go n.warnIfLegacyReceipts(parallax)

	n.emit("started", nil)
	return nil
}

// Stop tears down the node. It is idempotent.
func (n *NodeController) Stop() error {
	n.mu.Lock()
	stack := n.stack
	stopCh := n.stopCh
	n.stack = nil
	n.parallax = nil
	n.stopCh = nil
	n.dev = false
	n.mu.Unlock()
	if stack == nil {
		return nil
	}
	if stopCh != nil {
		// Signal background helpers (disk monitor) to exit before we close
		// the stack so they don't race against a half-torn-down node.
		close(stopCh)
	}
	err := stack.Close()
	n.emit("stopped", nil)
	return err
}

// Status returns the dashboard snapshot.
func (n *NodeController) Status() NodeStatus {
	n.mu.RLock()
	stack := n.stack
	parallax := n.parallax
	startedAt := n.startedAt
	dev := n.dev
	n.mu.RUnlock()

	guiCfg := n.cfg.Get()
	st := NodeStatus{
		DataDir:   nodeDataDir(guiCfg),
		ChainID:   chainparams.MainnetChainConfig.ChainID.Uint64(),
		NetworkID: 2110,
		// The daemon's version, which is what "client" means to a node
		// operator; the GUI's own version shows in the status bar
		ClientVersion: "Parallax/v" + parallaxpkg.VersionWithMeta,
	}
	if guiCfg.HTTPRPCEnabled {
		st.RPCEndpoint = rpcEndpoint(guiCfg)
	}
	if stack == nil || parallax == nil {
		return st
	}
	st.Running = true
	// The running chain's own ID, rather than the mainnet constant
	if cfg := parallax.BlockChain().Config(); cfg != nil && cfg.ChainID != nil {
		st.ChainID = cfg.ChainID.Uint64()
	}
	st.UptimeSeconds = int64(time.Since(startedAt).Seconds())
	st.Peers = stack.Server().PeerCount()

	// Sync status logic:
	//
	//   - Use the downloader's progress as the truth source. Progress.HighestBlock
	//     is set from peer head announcements during synchronisation, so
	//     CurrentBlock >= HighestBlock means our local chain has caught up
	//     to the highest tip any connected peer has reported. This is the
	//     same comparison eth_syncing uses.
	//   - Do NOT consult parallax.Synced() — that flag is gated on the first
	//     post-sync block import, so it stays false (and the dashboard would
	//     stay stuck on "Syncing") until the next block arrives, even when
	//     we are demonstrably at the tip.
	//   - Without peers we have no reference point, so claim "syncing" rather
	//     than falsely reporting "synced".
	prog := parallax.Downloader().Progress()
	st.CurrentBlock = prog.CurrentBlock
	st.HighestBlock = prog.HighestBlock
	st.StartingBlock = prog.StartingBlock

	if head := parallax.BlockChain().CurrentBlock(); head != nil {
		if head.NumberU64() > st.CurrentBlock {
			st.CurrentBlock = head.NumberU64()
		}
		if st.HighestBlock < st.CurrentBlock {
			st.HighestBlock = st.CurrentBlock
		}
	}

	caughtUp := st.HighestBlock == 0 || st.CurrentBlock >= st.HighestBlock
	// The development chain has no peers to sync from: it is its own tip
	st.Syncing = !dev && (st.Peers == 0 || !caughtUp)
	st.DevChain = dev
	if dev {
		st.NetworkID = devNetworkID
		st.DevHeld = !parallax.IsMining()
	}

	st.DiskUsedBytes = n.diskUsage(st.DataDir)

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	st.MemUsedBytes = ms.Alloc
	return st
}

// rpcEndpoint is the URL local apps reach the HTTP-RPC server at.
func rpcEndpoint(g GUIConfig) string {
	host := httpHost(g)
	if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(g.HTTPRPCPort))
}

// buildConfigs translates GUIConfig into a node.Config + nodeconfig.Config pair.
func buildConfigs(g GUIConfig) (node.Config, nodeconfig.Config, error) {
	dev := devChain(g)
	if dev {
		if _, err := devFundAddress(g); err != nil {
			return node.Config{}, nodeconfig.Config{}, err
		}
		g = devGUIConfig(g)
	}
	nodeCfg := node.DefaultConfig
	nodeCfg.Name = "ParallaxGUI"
	// The node goes by the Parallax client's version, as parallaxd does
	// (2.1.3-stable-71d7cead), not the app's: it is the client peers and
	// the logs should know it by
	nodeCfg.Version = parallaxpkg.VersionWithCommit(daemonCommit(), "")
	nodeCfg.DataDir = g.DataDir
	nodeCfg.IPCPath = "parallax.ipc"
	nodeCfg.UserIdent = strings.TrimSpace(g.NodeName)

	if g.MaxPeers > 0 {
		nodeCfg.P2P.MaxPeers = g.MaxPeers
	}
	// Without bootstrap nodes the embedded node has nothing to dial; the
	// CLI binary wires these up via cmd/utils/flags.go. We replicate that
	// here so the GUI can actually find peers on a fresh install. v2 splits
	// bootstrapping into three paths: enode:// URLs feeding the legacy
	// discv4 table, plain ip:port endpoints for the BIP324-style v2
	// handshake, and DNS seeds resolved on a 24h cadence into addrman.
	// Custom bootnodes from the config replace the first two.
	nodeCfg.P2P.BootstrapNodes = parseEnodes(netparams.MainnetBootnodes)
	nodeCfg.P2P.BootstrapNodesV2 = parseV2Bootnodes(netparams.MainnetBootnodesV2)
	nodeCfg.P2P.DNSSeeds = netparams.MainnetDNSSeeds
	// The peers the user pinned or trusted from the peer list
	nodeCfg.P2P.StaticNodes = parseEnodes(g.StaticPeers)
	nodeCfg.P2P.TrustedNodes = parseEnodes(g.TrustedPeers)
	if err := applyP2PFlags(g, &nodeCfg.P2P); err != nil {
		return nodeCfg, nodeconfig.Config{}, err
	}
	if err := applyRPCFlags(g, &nodeCfg); err != nil {
		return nodeCfg, nodeconfig.Config{}, err
	}

	prlCfg := nodeconfig.Defaults
	switch g.SyncMode {
	case "full":
		prlCfg.SyncMode = downloader.FullSync
	case "light":
		prlCfg.SyncMode = downloader.LightSync
	default:
		prlCfg.SyncMode = downloader.SnapSync
	}
	if g.DatabaseCacheMB > 0 {
		prlCfg.DatabaseCache = g.DatabaseCacheMB
	}
	if g.TrieCleanCacheMB > 0 {
		prlCfg.TrieCleanCache = g.TrieCleanCacheMB
	}
	if g.TrieDirtyCacheMB > 0 {
		prlCfg.TrieDirtyCache = g.TrieDirtyCacheMB
	}
	if g.SnapshotCacheMB > 0 {
		prlCfg.SnapshotCache = g.SnapshotCacheMB
	}

	// DNS discovery: same default the CLI applies for mainnet. Without
	// these URLs the prl handler does not bootstrap a discovery iterator,
	// so peers are only ever found via the static bootstrap nodes above.
	// (--nodiscover clears them again in applyPrlFlags.)
	if url := netparams.KnownDNSNetwork(chainparams.MainnetGenesisHash, "all"); url != "" {
		prlCfg.ParallaxDiscoveryURLs = []string{url}
		prlCfg.SnapDiscoveryURLs = []string{url}
	}

	// The smart fee estimator (--gpo.smartfee, on by default since v2.0.0)
	// and the rest of the oracle, the pool and the RPC caps.
	// All of them are read once inside protocol.New(), so they take effect
	// on a fresh node start — the Settings UI flags them restart-required.
	if err := applyPrlFlags(g, &prlCfg); err != nil {
		return nodeCfg, prlCfg, err
	}

	if dev {
		applyDevChain(&nodeCfg, &prlCfg)
	}

	if prlCfg.SyncMode == downloader.LightSync {
		return nodeCfg, prlCfg, errors.New("light sync from GUI not supported yet")
	}
	return nodeCfg, prlCfg, nil
}

// ValidateConfig reports the first setting the node would refuse to start
// with, so Settings can reject it on save rather than at the next start.
func ValidateConfig(g GUIConfig) error {
	if g.OfflineFeeCapWei != "" {
		if v, ok := parseDecimal(g.OfflineFeeCapWei); !ok || v.Sign() <= 0 {
			return ErrOfflineFeeCap
		}
	}
	if g.AutoLockMinutes < -1 || g.AutoLockMinutes > maxAutoLockMinutes {
		return errors.New("the auto-lock time must be at most a day")
	}
	if g.MCPPort < 0 || g.MCPPort > 65535 {
		return errors.New("the AI assistant port must be between 1 and 65535")
	}
	if g.MCPEnabled && g.HTTPRPCEnabled && mcpPort(g) == g.HTTPRPCPort {
		return errors.New("HTTP-RPC and the AI assistant server need different ports")
	}
	_, _, err := buildConfigs(g)
	return err
}

// monitorFreeDiskSpace polls the data directory's free space every 30s and
// triggers a graceful Stop() if it crosses below `criticalBytes`. The
// behaviour mirrors cmd/utils/cmd.go:monitorFreeDiskSpace, which exists to
// prevent silent database corruption when the disk fills up mid-import.
//
// Two thresholds:
//   - free <= critical:   shut down now, log at error level
//   - free <= 2*critical: warn that shutdown is imminent if it keeps falling
func (n *NodeController) monitorFreeDiskSpace(path string, criticalBytes uint64, stopCh <-chan struct{}) {
	const interval = 30 * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	check := func() bool {
		free, err := getFreeDiskSpace(path)
		if err != nil {
			logging.Warn("Failed to get free disk space", "path", path, "err", err)
			return true // keep polling — transient errors shouldn't kill the monitor
		}
		if free <= criticalBytes {
			logging.Error(
				"Low disk space. Gracefully shutting down Parallax to prevent database corruption.",
				"available", util.StorageSize(free),
				"critical", util.StorageSize(criticalBytes),
			)
			// Detach the shutdown so we don't deadlock against Stop() racing
			// with this goroutine waking up.
			n.emit("lowdisk", nil) // so the frontend can say why the node stopped
			go func() { _ = n.Stop() }()
			return false
		}
		if free <= 2*criticalBytes {
			logging.Warn(
				"Disk space is running low. Parallax will shut down if it crosses the critical threshold.",
				"available", util.StorageSize(free),
				"critical", util.StorageSize(criticalBytes),
			)
		}
		return true
	}

	// Run an immediate check at startup so a node launched on an
	// already-full disk fails fast instead of waiting 30s.
	if !check() {
		return
	}
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			if !check() {
				return
			}
		}
	}
}

// warnIfLegacyReceipts logs a one-shot warning if the chain database
// contains receipts in the pre-migration format. The CLI does the same in
// cmd/parallaxd/config.go after registering the parallax service.
func (n *NodeController) warnIfLegacyReceipts(parallax *protocol.Parallax) {
	defer func() {
		// This walks the freezer at startup; if anything panics we don't
		// want to take down the GUI's startup goroutine with it.
		if r := recover(); r != nil {
			logging.Debug("legacy receipts check failed", "panic", r)
		}
	}()

	db := parallax.ChainDb()
	numAncients, err := db.Ancients()
	if err != nil || numAncients < 1 {
		return
	}

	// Skip the empty-block prefix on mainnet (matches cmd/parallaxd/config.go).
	firstIdx := uint64(0)
	if rawhash := parallax.BlockChain().Genesis().Hash(); rawhash == chainparams.MainnetGenesisHash {
		firstIdx = 7661
	}
	if firstIdx >= numAncients {
		return
	}

	emptyRLPList := []byte{192}
	for i := firstIdx; i < numAncients; i++ {
		blob, err := db.Ancient("receipts", i)
		if err != nil || len(blob) == 0 {
			continue
		}
		if len(blob) > 0 && blob[0] != emptyRLPList[0] {
			// First byte 0x82..0xb7 indicates a list — receipts are RLP
			// lists. We just need to spot a non-empty one to confirm there
			// is data; the actual format detection happens in db
			// freezer-migrate. Bail after the first hit.
			logging.Warn("Database may contain legacy receipts. Run `parallaxd db freezer-migrate` if you upgraded from an older release.")
			return
		}
		break
	}
}

// parseEnodes converts a slice of enode URLs into resolved nodes, skipping
// (and logging) any malformed entries instead of crashing the GUI.
func parseEnodes(urls []string) []*enode.Node {
	out := make([]*enode.Node, 0, len(urls))
	for _, url := range urls {
		if url == "" {
			continue
		}
		n, err := enode.Parse(enode.ValidSchemes, url)
		if err != nil {
			logging.Error("invalid enode", "enode", url, "err", err)
			continue
		}
		out = append(out, n)
	}
	return out
}

// parseV2Bootnodes converts v2 bootstrap entries ("ip:port" or
// "<addr>.onion:port", netparams.MainnetBootnodesV2) into addrman
// addresses, skipping (and logging) malformed entries instead of crashing
// the GUI. Mirrors cmd/utils/flags.go setBootstrapNodes.
func parseV2Bootnodes(entries []string) []addrman.NetAddr {
	out := make([]addrman.NetAddr, 0, len(entries))
	for _, raw := range entries {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		na, err := addrman.ParseHostPort(raw)
		if err != nil {
			logging.Error("invalid v2 bootstrap entry (expected ip:port or <addr>.onion:port)", "entry", raw, "err", err)
			continue
		}
		out = append(out, na)
	}
	return out
}

// setAccountManagerBackends installs the node's own keystore backend
// (<datadir>/keystore, as parallaxd does) so that the node.Node accounts
// manager has at least one backend registered. The app's wallet keeps its
// keys elsewhere and never attaches them here (wallet.go), so no RPC client
// can list or use them.
func setAccountManagerBackends(stack *node.Node) *keystore.KeyStore {
	conf := stack.Config()
	keydir := stack.KeyStoreDir()
	scryptN := keystore.StandardScryptN
	scryptP := keystore.StandardScryptP
	if conf.UseLightweightKDF {
		scryptN = keystore.LightScryptN
		scryptP = keystore.LightScryptP
	}
	ks := keystore.NewKeyStore(keydir, scryptN, scryptP)
	stack.AccountManager().AddBackend(ks)
	return ks
}

// Peers returns a snapshot of the current peer set, suitable for both the
// dashboard's compact list and the full Peers screen. Rows are sorted by
// full node ID so that the order is stable across polls — without this,
// the underlying p2p.Server map iteration shuffles the list every refresh
// and the UI flickers.
func (n *NodeController) Peers() []PeerView {
	stack := n.Stack()
	if stack == nil {
		return []PeerView{}
	}
	srv := stack.Server()
	if srv == nil {
		return []PeerView{}
	}
	peers := srv.Peers()
	out := make([]PeerView, 0, len(peers))
	for _, p := range peers {
		info := p.Info()
		// v2-handshake peers carry no persistent node identity (ID, Enode
		// and ENR marshal as null), so fall back to the peer's dial target
		// (Network.Address, which the daemon itself keys v2 peers on) or,
		// for inbound peers without one, the remote socket endpoint. The
		// short id doubles as a "v2" badge.
		fullID := ""
		if info.ID != nil {
			fullID = *info.ID
		}
		enodeURL := ""
		if info.Enode != nil {
			enodeURL = *info.Enode
		}
		shortID := fullID
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		if fullID == "" {
			addr := info.Network.Address
			if addr == "" {
				addr = info.Network.RemoteAddress
			}
			fullID = "v2@" + addr
			shortID = "v2"
		}
		out = append(out, PeerView{
			ID:         shortID,
			FullID:     fullID,
			Enode:      enodeURL,
			Name:       info.Name,
			RemoteAddr: info.Network.RemoteAddress,
			LocalAddr:  info.Network.LocalAddress,
			Address:    info.Network.Address,
			Network:    info.Network.Network,
			MinPingMs:  info.MinPing * 1000,
			Inbound:    info.Network.Inbound,
			Trusted:    info.Network.Trusted,
			Static:     info.Network.Static,
			Caps:       info.Caps,
			Protocols:  info.Protocols,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].FullID < out[j].FullID })
	return out
}

// RecentBlocks returns up to n most recent canonical blocks (newest first).
// Walks the chain head backwards via the in-process BlockChain — no RPC.
func (n *NodeController) RecentBlocks(count int) []BlockView {
	if count <= 0 {
		count = 10
	}
	if count > 50 {
		count = 50
	}
	parallax := n.Parallax()
	if parallax == nil {
		return []BlockView{}
	}
	bc := parallax.BlockChain()
	head := bc.CurrentBlock()
	if head == nil {
		return []BlockView{}
	}
	out := make([]BlockView, 0, count)
	headNum := head.NumberU64()
	for i := 0; i < count; i++ {
		if uint64(i) > headNum {
			break
		}
		num := headNum - uint64(i)
		block := bc.GetBlockByNumber(num)
		if block == nil {
			continue
		}
		out = append(out, BlockView{
			Number:     num,
			Hash:       block.Hash().Hex(),
			Timestamp:  int64(block.Time()),
			TxCount:    len(block.Transactions()),
			GasUsed:    block.GasUsed(),
			GasLimit:   block.GasLimit(),
			SizeBytes:  uint64(block.Size()),
			RewardWei:  blockRewardAt(num).String(),
			Difficulty: block.Difficulty().String(),
		})
	}
	return out
}

// RecentTransactions walks the chain backwards from the head and collects up
// to `count` of the most recent transactions, newest first. We re-use the
// in-process BlockChain accessor instead of going through eth_getBlockByNumber
// so the dashboard refresh stays cheap.
func (n *NodeController) RecentTransactions(count int) []TxView {
	if count <= 0 {
		count = 6
	}
	if count > 100 {
		count = 100
	}
	parallax := n.Parallax()
	if parallax == nil {
		return []TxView{}
	}
	bc := parallax.BlockChain()
	head := bc.CurrentBlock()
	if head == nil {
		return []TxView{}
	}
	signer := types.LatestSignerForChainID(bc.Config().ChainID)

	out := make([]TxView, 0, count)
	headNum := head.NumberU64()

	// Bound the walk so we don't scan the entire history if recent blocks
	// are empty. ~200 blocks of look-back is plenty for a UI sample.
	for i := uint64(0); i < 200 && len(out) < count; i++ {
		if i > headNum {
			break
		}
		num := headNum - i
		block := bc.GetBlockByNumber(num)
		if block == nil {
			continue
		}
		ts := int64(block.Time())
		for _, tx := range block.Transactions() {
			if len(out) >= count {
				break
			}
			from, err := types.Sender(signer, tx)
			fromHex := ""
			if err == nil {
				fromHex = from.Hex()
			}
			to := ""
			kind := "call"
			if tx.To() == nil {
				kind = "contract"
			} else {
				to = tx.To().Hex()
				if len(tx.Data()) == 0 {
					kind = "transfer"
				}
			}
			out = append(out, TxView{
				Hash:      tx.Hash().Hex(),
				Block:     num,
				Timestamp: ts,
				From:      fromHex,
				To:        to,
				ValueWei:  tx.Value().String(),
				GasUsed:   tx.Gas(),
				Kind:      kind,
			})
		}
	}
	return out
}

// blockRewardAt mirrors consensus/xhash.calcBlockReward (which is unexported).
// We rely on the public constants InitialBlockRewardWei + HalvingIntervalBlocks
// so the two stay in lock-step.
func blockRewardAt(blockNumber uint64) *big.Int {
	if blockNumber == 0 {
		return new(big.Int)
	}
	reward := new(big.Int).Set(xhash.InitialBlockRewardWei)
	halvings := blockNumber / xhash.HalvingIntervalBlocks
	if halvings > 63 {
		return new(big.Int)
	}
	reward.Rsh(reward, uint(halvings))
	return reward
}

// directorySize sums the size of all files under root. Errors are swallowed
// because this only feeds a UI gauge.
func directorySize(root string) uint64 {
	if root == "" {
		return 0
	}
	var total uint64
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err == nil {
			total += uint64(info.Size())
		}
		return nil
	})
	return total
}
