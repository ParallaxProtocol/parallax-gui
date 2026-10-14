package backend

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/node/nodeconfig"
)

// TestBuildConfigsDefaults checks that a config with none of the flag
// fields set configures the node as a bare parallaxd would.
func TestBuildConfigsDefaults(t *testing.T) {
	g := defaultGUIConfig()
	g.DataDir = t.TempDir()
	nodeCfg, prlCfg, err := buildConfigs(g)
	if err != nil {
		t.Fatal(err)
	}
	p := nodeCfg.P2P
	if p.ListenAddr != ":32110" || p.NAT == nil || !p.ListenOnion || p.NoDiscovery || len(p.DNSSeeds) == 0 {
		t.Errorf("p2p defaults changed: listen %q nat %v onion %v nodiscover %v seeds %d",
			p.ListenAddr, p.NAT, p.ListenOnion, p.NoDiscovery, len(p.DNSSeeds))
	}
	if p.AddrBookPath != filepath.Join(g.DataDir, "addrbook.rlp") || p.BanListPath == "" || p.NodeFilter == nil {
		t.Errorf("address book, ban list or node filter not set: %q %q", p.AddrBookPath, p.BanListPath)
	}
	if nodeCfg.HTTPHost != "127.0.0.1" || nodeCfg.HTTPPort != 8545 || strings.Join(nodeCfg.HTTPModules, ",") != "net,web3,eth,debug" {
		t.Errorf("http defaults changed: %s:%d %v", nodeCfg.HTTPHost, nodeCfg.HTTPPort, nodeCfg.HTTPModules)
	}
	if nodeCfg.WSHost != "" || nodeCfg.IPCPath == "" {
		t.Errorf("ws on or ipc off by default")
	}
	d := nodeconfig.Defaults
	if prlCfg.TxLookupLimit != d.TxLookupLimit || prlCfg.NoPruning || prlCfg.RPCGasCap != d.RPCGasCap ||
		prlCfg.TxPool.PriceLimit != d.TxPool.PriceLimit || prlCfg.GPO.MaxPrice.Cmp(d.GPO.MaxPrice) != 0 ||
		prlCfg.Miner.GasCeil != d.Miner.GasCeil || len(prlCfg.ParallaxDiscoveryURLs) == 0 {
		t.Errorf("prl defaults changed")
	}
	if !prlCfg.GPO.EnableSmartFeeEstimator {
		t.Errorf("smart fee off by default")
	}
}

func TestBuildConfigsFlags(t *testing.T) {
	u := func(v uint64) *uint64 { return &v }
	i := func(v int) *int { return &v }
	g := defaultGUIConfig()
	g.DataDir = t.TempDir()
	g.NodeName = " rig-1 "
	g.ArchiveMode = true
	g.ListenPort = 40000
	g.NATMode = "extip"
	g.ExternalIP = "203.0.113.7"
	g.NoDiscovery = true
	g.LegacyDiscovery = "off"
	g.NetRestrict = "10.0.0.0/8, 192.168.0.0/16"
	g.Bootnodes = []string{"203.0.113.9:32110"}
	g.Proxy = "127.0.0.1:9050"
	g.OnlyNet = []string{"onion"}
	g.NoListenOnion = true
	g.HTTPHost = "0.0.0.0"
	g.HTTPAPIs = []string{"eth"}
	g.WSEnabled = true
	g.GraphQL = true
	g.IPCDisabled = true
	g.RPCGasCap = u(0)
	g.RPCPVMTimeoutSec = i(10)
	g.TxPoolLocals = []string{"0x00000000000000000000000000000000000000aa"}
	g.TxPoolPriceLimit = u(5)
	g.TxPoolLifetimeMin = i(30)
	g.GPOMaxPrice = "1000"
	g.MinerExtraData = "hello"
	g.MinerGasPrice = "7"

	nodeCfg, prlCfg, err := buildConfigs(g)
	if err != nil {
		t.Fatal(err)
	}
	p := nodeCfg.P2P
	if nodeCfg.UserIdent != "rig-1" || p.ListenAddr != ":40000" || p.NAT == nil || !p.NoDiscovery || p.DNSSeeds != nil ||
		p.LegacyDiscoveryMode != "off" || p.NetRestrict == nil || len(p.BootstrapNodesV2) != 1 || len(p.BootstrapNodes) != 0 ||
		p.ProxyAddr != "127.0.0.1:9050" || p.ListenOnion {
		t.Errorf("p2p flags not applied: %+v", p)
	}
	if nodeCfg.HTTPHost != "0.0.0.0" || strings.Join(nodeCfg.HTTPModules, ",") != "eth" || nodeCfg.WSHost != "127.0.0.1" ||
		nodeCfg.WSPort != 8546 || nodeCfg.IPCPath != "" || len(nodeCfg.GraphQLVirtualHosts) == 0 {
		t.Errorf("rpc flags not applied")
	}
	if !prlCfg.NoPruning || !prlCfg.Preimages || prlCfg.TxLookupLimit != 0 || len(prlCfg.ParallaxDiscoveryURLs) != 0 ||
		prlCfg.RPCGasCap != 0 || prlCfg.RPCPVMTimeout != 10*time.Second || len(prlCfg.TxPool.Locals) != 1 ||
		prlCfg.TxPool.PriceLimit != 5 || prlCfg.TxPool.Lifetime != 30*time.Minute || prlCfg.GPO.MaxPrice.Int64() != 1000 ||
		string(prlCfg.Miner.ExtraData) != "hello" || prlCfg.Miner.GasPrice.Int64() != 7 {
		t.Errorf("prl flags not applied")
	}
	if got := rpcEndpoint(g); got != "http://127.0.0.1:8545" {
		t.Errorf("endpoint for 0.0.0.0 = %s", got)
	}
}

func TestValidateConfigRejects(t *testing.T) {
	for name, edit := range map[string]func(*GUIConfig){
		"bad nat ip":     func(g *GUIConfig) { g.NATMode = "extip"; g.ExternalIP = "nope" },
		"bad cidr":       func(g *GUIConfig) { g.NetRestrict = "10.0.0.0/99" },
		"bad bootnode":   func(g *GUIConfig) { g.Bootnodes = []string{"not a node"} },
		"bad proxy":      func(g *GUIConfig) { g.Proxy = "9050" },
		"bad onlynet":    func(g *GUIConfig) { g.OnlyNet = []string{"i2p"} },
		"bad local":      func(g *GUIConfig) { g.TxPoolLocals = []string{"0x12"} },
		"bad wei":        func(g *GUIConfig) { g.MinerGasPrice = "1.5" },
		"long extradata": func(g *GUIConfig) { g.MinerExtraData = strings.Repeat("x", 33) },
		"graphql no rpc": func(g *GUIConfig) { g.GraphQL = true; g.HTTPRPCEnabled = false },
		"ws on rpc port": func(g *GUIConfig) { g.WSEnabled = true; g.WSPort = g.HTTPRPCPort },
		"bad legacy":     func(g *GUIConfig) { g.LegacyDiscovery = "maybe" },
	} {
		g := defaultGUIConfig()
		edit(&g)
		if err := ValidateConfig(g); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
