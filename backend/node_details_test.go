package backend

import (
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/node"
	protocol "github.com/ParallaxProtocol/parallax/v2/node/fullnode"
)

// TestNodeDetailsFromLiveNode reads Details from an embedded node on a
// throwaway datadir, isolated from the network as in the v2 smoke test,
// and checks every part that a fresh node can answer.
func TestNodeDetailsFromLiveNode(t *testing.T) {
	g := defaultGUIConfig()
	g.DataDir = t.TempDir()
	g.HTTPRPCEnabled = false
	g.BlockInbound = true
	g.ReportStats = false
	g.DatabaseCacheMB = 64
	g.TrieCleanCacheMB = 16
	g.TrieDirtyCacheMB = 16
	g.SnapshotCacheMB = 16

	nodeCfg, prlCfg, err := buildConfigs(g)
	if err != nil {
		t.Fatalf("buildConfigs: %v", err)
	}
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
	prl, err := protocol.New(stack, &prlCfg)
	if err != nil {
		t.Fatalf("protocol.New: %v", err)
	}
	if err := stack.Start(); err != nil {
		t.Fatalf("stack.Start: %v", err)
	}

	n := &NodeController{cfg: &ConfigStore{cfg: g}, stack: stack, parallax: prl, diskCritical: 32 << 20}

	stopped := (&NodeController{cfg: &ConfigStore{cfg: g}}).Details()
	if stopped.Running || stopped.NodeID != "" {
		t.Errorf("stopped node: want zero details, got %+v", stopped)
	}

	d := n.Details()
	t.Logf("%+v", d)
	if !d.Running {
		t.Fatal("not running")
	}
	if d.NodeID == "" || d.ListenPort == 0 || d.ClientName == "" {
		t.Errorf("identity missing: id=%q port=%d name=%q", d.NodeID, d.ListenPort, d.ClientName)
	}
	if d.InboundAllowed {
		t.Error("inbound reported allowed with BlockInbound set")
	}
	if d.MaxPeers != stack.Server().MaxPeers {
		t.Errorf("max peers %d, server has %d", d.MaxPeers, stack.Server().MaxPeers)
	}
	// At genesis the next block pays the full reward, and the first halving is ahead
	if d.BlockRewardWei != "50000000000000000000" {
		t.Errorf("block reward %s, want 50 LAX in wei", d.BlockRewardWei)
	}
	if d.NextHalvingBlock == 0 || d.BlocksToHalving != d.NextHalvingBlock {
		t.Errorf("halving: next %d, in %d blocks", d.NextHalvingBlock, d.BlocksToHalving)
	}
	if d.TotalDifficulty == "" || d.TotalDifficulty == "0" {
		t.Errorf("total difficulty %q", d.TotalDifficulty)
	}
	if d.GasPriceWei == "" {
		t.Error("no suggested gas price")
	}
	if d.SyncModeActive == "" || d.SyncModeConfigured == "" {
		t.Errorf("sync modes: configured %q, active %q", d.SyncModeConfigured, d.SyncModeActive)
	}
	if d.DiskFreeBytes == 0 || d.DiskStopBelowBytes != 32<<20 {
		t.Errorf("disk: free %d, stop below %d", d.DiskFreeBytes, d.DiskStopBelowBytes)
	}
	if m := n.Mempool("", 0); m.Pending != 0 || m.Queued != 0 || m.Txs == nil {
		t.Errorf("fresh pool: %+v", m)
	}
	if m := (&NodeController{cfg: &ConfigStore{cfg: g}}).Mempool("", 0); m.Txs == nil {
		t.Error("stopped node: want an empty list, not null")
	}
	if d.StatsName != "" || d.StatsHost != "" {
		t.Errorf("stats reported while off: %q on %q", d.StatsName, d.StatsHost)
	}
}
