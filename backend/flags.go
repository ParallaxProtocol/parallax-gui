// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"net"
	"path/filepath"
	godebug "runtime/debug"
	"strings"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/node"
	"github.com/ParallaxProtocol/parallax/v2/node/nodeconfig"
	"github.com/ParallaxProtocol/parallax/v2/p2p"
	"github.com/ParallaxProtocol/parallax/v2/p2p/addrman"
	"github.com/ParallaxProtocol/parallax/v2/p2p/enode"
	"github.com/ParallaxProtocol/parallax/v2/p2p/nat"
	"github.com/ParallaxProtocol/parallax/v2/p2p/netutil"
	"github.com/ParallaxProtocol/parallax/v2/primitives/rlp"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/util/fdlimit"
	gopsutil "github.com/shirou/gopsutil/mem"
)

// This file applies the GUIConfig fields that mirror parallaxd's flags,
// following cmd/utils/flags.go setter by setter so the embedded node is
// configured exactly as `parallaxd --<flag>` would be. Every setter leaves
// the default alone when its field is unset.

// defaultModules are the RPC namespaces served when the user picks none:
// node.DefaultConfig's {"net", "web3"}, plus "eth" for wallets and dapps
// and "debug" for the tracer APIs Start registers.
var defaultModules = []string{"net", "web3", "eth", "debug"}

// applyP2PFlags mirrors SetP2PConfig and the p2p path defaults of
// SetNodeConfig.
func applyP2PFlags(g GUIConfig, cfg *p2p.Config) error {
	if g.ListenPort > 0 {
		cfg.ListenAddr = fmt.Sprintf(":%d", g.ListenPort)
	}
	if g.MaxPendingPeers > 0 {
		cfg.MaxPendingPeers = g.MaxPendingPeers
	}

	// --nat. Blocking inbound is the GUI's `--nat none`: without a port
	// mapping peers outside the LAN cannot dial us, while we still dial out.
	switch {
	case g.BlockInbound:
		cfg.NAT = nil
	case g.NATMode == "" || g.NATMode == "any":
		cfg.NAT = nat.Any()
	default:
		spec := g.NATMode
		if spec == "extip" {
			spec = "extip:" + strings.TrimSpace(g.ExternalIP)
		}
		natif, err := nat.Parse(spec)
		if err != nil {
			return fmt.Errorf("NAT mapping %q: %w", spec, err)
		}
		cfg.NAT = natif
	}

	// --bootnodes: entries sniffed per form, enode URLs for the legacy
	// discv4 table and ip:port endpoints for the v2 handshake, as in
	// setBootstrapNodes. Custom entries replace the built-in ones.
	if len(g.Bootnodes) > 0 {
		var enodes, v2 []string
		for _, raw := range g.Bootnodes {
			raw = strings.TrimSpace(raw)
			switch {
			case raw == "":
			case strings.HasPrefix(raw, "enode://") || strings.HasPrefix(raw, "enr:"):
				if _, err := enode.Parse(enode.ValidSchemes, raw); err != nil {
					return fmt.Errorf("bootstrap node %q: %w", raw, err)
				}
				enodes = append(enodes, raw)
			default:
				if _, err := addrman.ParseHostPort(raw); err != nil {
					return fmt.Errorf("bootstrap node %q: expected an enode URL, ip:port or <addr>.onion:port", raw)
				}
				v2 = append(v2, raw)
			}
		}
		cfg.BootstrapNodes = parseEnodes(enodes)
		cfg.BootstrapNodesV2 = parseV2Bootnodes(v2)
	}

	// --nodiscover also stops the DNS seeds (setDNSSeeds); the DNS
	// discovery trees are cleared in applyPrlFlags.
	if g.NoDiscovery {
		cfg.NoDiscovery = true
		cfg.DNSSeeds = nil
	}
	switch g.LegacyDiscovery {
	case "", "auto":
	case "on", "off":
		cfg.LegacyDiscoveryMode = g.LegacyDiscovery
	default:
		return fmt.Errorf("legacy discovery must be auto, on or off, not %q", g.LegacyDiscovery)
	}
	if s := strings.TrimSpace(g.NetRestrict); s != "" {
		list, err := netutil.ParseNetlist(s)
		if err != nil {
			return fmt.Errorf("network restriction: %w", err)
		}
		cfg.NetRestrict = list
	}

	// setProxy. The daemon validates the combination (an onion-only
	// restriction without an onion route, say) when the server starts.
	if g.Proxy != "" {
		if err := checkHostPort(g.Proxy); err != nil {
			return fmt.Errorf("proxy: %w", err)
		}
		cfg.ProxyAddr = g.Proxy
	}
	if g.OnionProxy != "" {
		if g.OnionProxy != "0" {
			if err := checkHostPort(g.OnionProxy); err != nil {
				return fmt.Errorf("onion proxy: %w", err)
			}
		}
		cfg.OnionProxyAddr = g.OnionProxy
	}
	for _, network := range g.OnlyNet {
		if network != "ipv4" && network != "ipv6" && network != "onion" {
			return fmt.Errorf("unknown network %q: expected ipv4, ipv6 or onion", network)
		}
	}
	cfg.OnlyNet = g.OnlyNet
	cfg.ProxyNoRandomize = g.ProxyNoRandomize
	cfg.ListenOnion = !g.NoListenOnion
	if g.TorControl != "" {
		if err := checkHostPort(g.TorControl); err != nil {
			return fmt.Errorf("Tor control port: %w", err)
		}
		cfg.TorControlAddr = g.TorControl
	}
	cfg.TorPassword = g.TorPassword

	// SetNodeConfig keeps the address book, the block-relay anchors, the
	// ban list and the onion service key in the data directory; without
	// these paths each lives in memory only and is lost on every restart.
	cfg.AddrBookPath = filepath.Join(g.DataDir, "addrbook.rlp")
	cfg.AnchorsPath = filepath.Join(g.DataDir, "anchors.dat")
	cfg.BanListPath = filepath.Join(g.DataDir, "banlist.json")
	cfg.OnionKeyPath = filepath.Join(g.DataDir, "onion_v3_private_key")

	// Discovery lookups skip nodes that aren't Parallax nodes
	cfg.NodeFilter = parallaxNodeFilter
	return nil
}

// applyRPCFlags mirrors setHTTP, setWS, setGraphQL and setIPC.
func applyRPCFlags(g GUIConfig, cfg *node.Config) error {
	// Browser dapps make cross-origin calls; the listener is on loopback
	// by default, so "*" only admits processes that already share the
	// machine.
	cfg.HTTPModules = orDefault(g.HTTPAPIs, defaultModules)
	cfg.HTTPCors = orDefault(g.HTTPCors, []string{"*"})
	// Both loopback names, so tools connecting by either pass the host check
	cfg.HTTPVirtualHosts = orDefault(g.HTTPVirtualHosts, []string{"localhost", "127.0.0.1"})
	if g.HTTPRPCEnabled {
		cfg.HTTPHost = httpHost(g)
		cfg.HTTPPort = g.HTTPRPCPort
	}
	if g.HTTPHost != "" && net.ParseIP(g.HTTPHost) == nil && g.HTTPHost != "localhost" {
		return fmt.Errorf("HTTP-RPC listen address %q is not an IP address", g.HTTPHost)
	}

	cfg.WSModules = orDefault(g.WSAPIs, defaultModules)
	cfg.WSOrigins = orDefault(g.WSOrigins, []string{"*"})
	if g.WSEnabled {
		cfg.WSHost = "127.0.0.1"
		if g.WSHost != "" {
			if net.ParseIP(g.WSHost) == nil && g.WSHost != "localhost" {
				return fmt.Errorf("WebSocket listen address %q is not an IP address", g.WSHost)
			}
			cfg.WSHost = g.WSHost
		}
		if g.WSPort > 0 {
			cfg.WSPort = g.WSPort
		}
		if g.HTTPRPCEnabled && cfg.WSHost == cfg.HTTPHost && cfg.WSPort == cfg.HTTPPort {
			return errors.New("HTTP-RPC and WebSocket need different ports")
		}
	}

	if g.GraphQL {
		if !g.HTTPRPCEnabled {
			return errors.New("GraphQL is served by the HTTP-RPC server: enable HTTP-RPC too")
		}
		cfg.GraphQLCors = cfg.HTTPCors
		cfg.GraphQLVirtualHosts = cfg.HTTPVirtualHosts
	}
	if g.IPCDisabled {
		cfg.IPCPath = ""
	}
	if g.RPCBatchLimit != nil {
		cfg.BatchRequestLimit = *g.RPCBatchLimit
	}
	cfg.AllowUnprotectedTxs = g.AllowUnprotectedTxs
	return nil
}

// applyPrlFlags mirrors the parts of SetPrlConfig, setTxPool and setGPO
// that the GUI exposes. Cache sizes and the sync mode are applied
// by buildConfigs.
func applyPrlFlags(g GUIConfig, cfg *nodeconfig.Config) error {
	if g.AncientDir != "" {
		cfg.DatabaseFreezer = g.AncientDir
	}
	cfg.NoPrefetch = g.NoPrefetch
	cfg.Preimages = g.Preimages
	if g.TxLookupLimit != nil {
		cfg.TxLookupLimit = *g.TxLookupLimit
	}
	// --gcmode archive keeps every state and needs the preimages and the
	// whole transaction index to go with it
	if g.ArchiveMode {
		cfg.NoPruning = true
		cfg.Preimages = true
		cfg.TxLookupLimit = 0
	}
	// Snap sync needs the snapshot, so --snapshot=false only applies to
	// full sync, whose snapshot memory goes to the trie cache instead
	if g.NoSnapshot && g.SyncMode == "full" {
		cfg.TrieCleanCache += cfg.SnapshotCache
		cfg.SnapshotCache = 0
	}
	if g.NoDiscovery {
		cfg.ParallaxDiscoveryURLs, cfg.SnapDiscoveryURLs = []string{}, []string{}
	}

	if g.RPCGasCap != nil {
		cfg.RPCGasCap = *g.RPCGasCap
	}
	if g.RPCTxFeeCap != nil {
		if *g.RPCTxFeeCap < 0 {
			return errors.New("the RPC transaction fee cap can't be negative")
		}
		cfg.RPCTxFeeCap = *g.RPCTxFeeCap
	}
	if g.RPCPVMTimeoutSec != nil {
		cfg.RPCPVMTimeout = time.Duration(*g.RPCPVMTimeoutSec) * time.Second
	}
	if g.RPCLogQueryLimit != nil {
		cfg.LogQueryLimit = *g.RPCLogQueryLimit
	}

	pool := &cfg.TxPool
	pool.Locals = nil
	for _, account := range g.TxPoolLocals {
		account = strings.TrimSpace(account)
		if !util.IsHexAddress(account) {
			return fmt.Errorf("local account %q is not an address", account)
		}
		pool.Locals = append(pool.Locals, util.HexToAddress(account))
	}
	pool.NoLocals = g.TxPoolNoLocals
	setUint64(&pool.PriceLimit, g.TxPoolPriceLimit)
	setUint64(&pool.PriceBump, g.TxPoolPriceBump)
	setUint64(&pool.AccountSlots, g.TxPoolAccountSlots)
	setUint64(&pool.GlobalSlots, g.TxPoolGlobalSlots)
	setUint64(&pool.AccountQueue, g.TxPoolAccountQueue)
	setUint64(&pool.GlobalQueue, g.TxPoolGlobalQueue)
	if g.TxPoolLifetimeMin != nil {
		pool.Lifetime = time.Duration(*g.TxPoolLifetimeMin) * time.Minute
	}

	gpo := &cfg.GPO
	gpo.EnableSmartFeeEstimator = g.EnableSmartFee
	if g.GPOBlocks != nil {
		gpo.Blocks = *g.GPOBlocks
	}
	if g.GPOPercentile != nil {
		if *g.GPOPercentile < 0 || *g.GPOPercentile > 100 {
			return errors.New("the gas price percentile must be between 0 and 100")
		}
		gpo.Percentile = *g.GPOPercentile
	}
	if err := setWei(&gpo.MaxPrice, g.GPOMaxPrice, "maximum gas price"); err != nil {
		return err
	}
	return setWei(&gpo.IgnorePrice, g.GPOIgnorePrice, "ignored gas price")
}

// tuneProcess applies the process-wide settings parallaxd makes before
// starting its node: it caps the caches at a third of the machine's memory
// so Go's garbage collector isn't starved, lowers the GC trigger so the
// database cache doesn't inflate it, and raises the open file limit,
// returning the database's share of it (SetPrlConfig, MakeDatabaseHandles).
func tuneProcess(g GUIConfig, cfg *nodeconfig.Config) int {
	total := cfg.DatabaseCache + cfg.TrieCleanCache + cfg.TrieDirtyCache + cfg.SnapshotCache
	if mem, err := gopsutil.VirtualMemory(); err == nil && mem.Total > 0 {
		if math.MaxUint == math.MaxUint32 && mem.Total > 2*1024*1024*1024 {
			mem.Total = 2 * 1024 * 1024 * 1024 // addressable on 32-bit
		}
		if allowance := int(mem.Total / 1024 / 1024 / 3); total > allowance {
			logging.Warn("Sanitizing cache to Go's GC limits", "provided", total, "updated", allowance)
			scale := func(v int) int { return v * allowance / total }
			cfg.DatabaseCache = scale(cfg.DatabaseCache)
			cfg.TrieCleanCache = scale(cfg.TrieCleanCache)
			cfg.TrieDirtyCache = scale(cfg.TrieDirtyCache)
			cfg.SnapshotCache = scale(cfg.SnapshotCache)
			total = allowance
		}
	}
	if total > 0 {
		godebug.SetGCPercent(int(math.Max(20, math.Min(100, 100/(float64(total)/1024)))))
	}

	limit, err := fdlimit.Maximum()
	if err != nil {
		logging.Warn("Failed to read the file descriptor allowance", "err", err)
		return 0
	}
	switch {
	case g.FDLimit == 0:
	case g.FDLimit < 128:
		logging.Error("File descriptor limit invalid (<128)", "had", g.FDLimit, "updated", limit)
	case g.FDLimit > limit:
		logging.Warn("Requested file descriptors denied by OS", "req", g.FDLimit, "limit", limit)
	default:
		limit = g.FDLimit
	}
	raised, err := fdlimit.Raise(uint64(limit))
	if err != nil {
		logging.Warn("Failed to raise the file descriptor allowance", "err", err)
		return 0
	}
	return int(raised / 2) // the other half for networking
}

// httpHost is the interface the HTTP-RPC server listens on.
func httpHost(g GUIConfig) string {
	if g.HTTPHost == "" {
		return "127.0.0.1"
	}
	return g.HTTPHost
}

// minFreeDiskBytes is the free space below which the node shuts down to
// save its database: the user's --datadir.minfreedisk, else twice the
// trie dirty cache, as parallaxd. 0 disables the check.
func minFreeDiskBytes(g GUIConfig, cfg *nodeconfig.Config) uint64 {
	if g.MinFreeDiskMB != nil {
		if *g.MinFreeDiskMB <= 0 {
			return 0
		}
		return uint64(*g.MinFreeDiskMB) * 1024 * 1024
	}
	return uint64(2*cfg.TrieDirtyCache) * 1024 * 1024
}

// parallaxNodeFilter accepts nodes that advertise the "parallax" ENR key
// (cmd/utils parallaxNodeFilter).
func parallaxNodeFilter(n *enode.Node) bool {
	var entry parallaxENREntry
	return n.Load(&entry) == nil
}

type parallaxENREntry struct {
	Rest []rlp.RawValue `rlp:"tail"`
}

func (e parallaxENREntry) ENRKey() string { return "parallax" }

func orDefault(v, def []string) []string {
	if len(v) == 0 {
		return append([]string(nil), def...)
	}
	return v
}

func setUint64(dst *uint64, v *uint64) {
	if v != nil {
		*dst = *v
	}
}

// setWei parses a decimal wei amount into dst, leaving dst alone when s is empty.
func setWei(dst **big.Int, s, what string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	v, ok := new(big.Int).SetString(s, 10)
	if !ok || v.Sign() < 0 {
		return fmt.Errorf("%s %q is not a whole number of wei", what, s)
	}
	*dst = v
	return nil
}

func checkHostPort(s string) error {
	if _, _, err := net.SplitHostPort(s); err != nil {
		return fmt.Errorf("%q is not host:port", s)
	}
	return nil
}
