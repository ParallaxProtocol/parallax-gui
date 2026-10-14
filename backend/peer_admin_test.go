package backend

import (
	"net"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/node"
	protocol "github.com/ParallaxProtocol/parallax/v2/node/fullnode"
	"github.com/ParallaxProtocol/parallax/v2/p2p/enode"
)

// TestPeerAdmin drives the peer actions against an embedded node, isolated
// from the network, through the daemon's admin API as the GUI does.
func TestPeerAdmin(t *testing.T) {
	dir := t.TempDir()
	g := defaultGUIConfig()
	g.DataDir = filepath.Join(dir, "data")
	g.HTTPRPCEnabled = false
	g.BlockInbound = true
	g.ReportStats = false
	g.DatabaseCacheMB, g.TrieCleanCacheMB, g.TrieDirtyCacheMB, g.SnapshotCacheMB = 64, 16, 16, 16

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
	setAccountManagerBackends(stack)
	prl, err := protocol.New(stack, &prlCfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := stack.Start(); err != nil {
		t.Fatal(err)
	}
	store := &ConfigStore{path: filepath.Join(dir, "gui.json"), cfg: g}
	n := &NodeController{cfg: store, stack: stack, parallax: prl}

	// Stopped: every action says so, and the ban list is empty
	off := &NodeController{cfg: store}
	if err := off.Ban("203.0.113.7", 60); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Errorf("stopped ban: %v", err)
	}
	if b, err := off.Banned(); err != nil || len(b) != 0 {
		t.Errorf("stopped list: %v %v", b, err)
	}

	// Ban by a peer's remote address (host:port), see it listed, lift it
	if err := n.Ban("203.0.113.7:32110", 3600); err != nil {
		t.Fatalf("ban: %v", err)
	}
	if err := n.Ban("198.51.100.0/24", 0); err != nil {
		t.Fatalf("ban subnet: %v", err)
	}
	if err := n.Ban("203.0.113.7", 60); err == nil {
		t.Error("banning twice: want the daemon's already-banned error")
	}
	banned, _ := n.Banned()
	if len(banned) != 2 {
		t.Fatalf("listed %d bans, want 2: %+v", len(banned), banned)
	}
	for _, b := range banned {
		if b.BannedUntil <= b.CreatedAt {
			t.Errorf("ban %s: until %d, created %d", b.Subnet, b.BannedUntil, b.CreatedAt)
		}
	}
	if err := n.Unban(banned[0].Subnet); err != nil {
		t.Errorf("unban %s: %v", banned[0].Subnet, err)
	}
	if err := n.ClearBanned(); err != nil {
		t.Errorf("clear: %v", err)
	}
	if b, _ := n.Banned(); len(b) != 0 {
		t.Errorf("after clearing: %+v", b)
	}

	// Disconnecting a peer that isn't there says so
	if err := n.DisconnectPeer("203.0.113.9:32110"); err == nil {
		t.Error("disconnecting an unknown peer: want an error")
	}
	if err := n.AddPeer("not an address"); err == nil {
		t.Error("adding garbage: want an error")
	}

	// Trust an enode: applied, saved, and cleared again; v2 addresses can't be trusted
	// A made-up peer on a closed local port, so nothing leaves the machine
	key, _ := crypto.GenerateKey()
	peer := enode.NewV4(&key.PublicKey, net.IPv4(127, 0, 0, 1), 1, 1).URLv4()
	withQuery := enode.NewV4(&key.PublicKey, net.IPv4(127, 0, 0, 1), 1, 0).URLv4() // "...?discport=0"
	if err := n.SetTrusted(peer, true); err != nil {
		t.Fatalf("trust: %v", err)
	}
	// The same peer written with a query is the same peer, not a second one
	if err := n.SetTrusted(withQuery, true); err != nil {
		t.Fatalf("trust again: %v", err)
	}
	if got := store.Get().TrustedPeers; len(got) != 1 {
		t.Errorf("saved trusted peers: %v", got)
	}
	if err := n.SetTrusted(peer, false); err != nil || len(store.Get().TrustedPeers) != 0 {
		t.Errorf("untrust: %v, left %v", err, store.Get().TrustedPeers)
	}
	if err := n.SetTrusted("203.0.113.9:32110", true); err == nil {
		t.Error("trusting a v2 address: want an error")
	}

	// A static enode peer is saved, and forgotten when disconnected
	if err := n.AddPeer(peer); err != nil {
		t.Fatalf("add static: %v", err)
	}
	if got := store.Get().StaticPeers; len(got) != 1 {
		t.Errorf("saved static peers: %v", got)
	}
	if err := n.DisconnectPeer(peer); err != nil {
		t.Errorf("remove static: %v", err)
	}
	if got := store.Get().StaticPeers; len(got) != 0 {
		t.Errorf("static peers after removing: %v", got)
	}

	// The saved lists feed the next start's p2p config
	g2 := g
	g2.StaticPeers, g2.TrustedPeers = []string{peer}, []string{peer}
	c2, _, err := buildConfigs(g2)
	if err != nil || len(c2.P2P.StaticNodes) != 1 || len(c2.P2P.TrustedNodes) != 1 {
		t.Errorf("start config: static %d trusted %d, %v", len(c2.P2P.StaticNodes), len(c2.P2P.TrustedNodes), err)
	}
}
