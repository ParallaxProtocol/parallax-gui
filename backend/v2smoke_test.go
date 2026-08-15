package backend

import (
	"testing"

	"github.com/ParallaxProtocol/parallax/node"
	protocol "github.com/ParallaxProtocol/parallax/node/fullnode"
	"github.com/ParallaxProtocol/parallax/node/fullnode/tracers"
)

// TestV2EmbeddedNodeStarts brings up the embedded node exactly the way
// NodeController.Start does, against a throwaway datadir, and tears it
// down again. Catches runtime wiring regressions the compiler can't.
func TestV2EmbeddedNodeStarts(t *testing.T) {
	g := defaultGUIConfig()
	g.DataDir = t.TempDir()
	g.HTTPRPCEnabled = false
	g.BlockInbound = true // no NAT/UPnP traffic from a unit test
	// Keep the smoke test light: minimal caches.
	g.DatabaseCacheMB = 64
	g.TrieCleanCacheMB = 16
	g.TrieDirtyCacheMB = 16
	g.SnapshotCacheMB = 16

	nodeCfg, prlCfg, err := buildConfigs(g)
	if err != nil {
		t.Fatalf("buildConfigs: %v", err)
	}
	// Don't collide with a real node or open outbound listeners.
	nodeCfg.P2P.ListenAddr = "127.0.0.1:0"
	nodeCfg.P2P.NoDiscovery = true
	nodeCfg.P2P.DNSSeeds = nil

	stack, err := node.New(&nodeCfg)
	if err != nil {
		t.Fatalf("node.New: %v", err)
	}
	defer stack.Close()
	if err := setAccountManagerBackends(stack); err != nil {
		t.Fatalf("setAccountManagerBackends: %v", err)
	}
	backend, err := protocol.New(stack, &prlCfg)
	if err != nil {
		t.Fatalf("protocol.New: %v", err)
	}
	stack.RegisterAPIs(tracers.APIs(backend.APIBackend))
	if err := stack.Start(); err != nil {
		t.Fatalf("stack.Start: %v", err)
	}
	if got := backend.BlockChain().CurrentBlock(); got == nil {
		t.Fatal("no current block after start")
	}
	if err := stack.Close(); err != nil {
		t.Fatalf("stack.Close: %v", err)
	}
}
