// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/util"
)

// TestDevChain starts the embedded node on the development chain and checks
// it is the private, funded, self-sufficient chain `parallaxd --dev` makes,
// kept out of the mainnet data directory, and that release builds ignore
// the setting.
func TestDevChain(t *testing.T) {
	fund := util.HexToAddress("0x809934Fd0543aCe5621082125162e6899544aF46")
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(t.TempDir(), "parallax")
	cfg.HTTPRPCEnabled = false
	cfg.IPCDisabled = true
	cfg.DevChain = true
	cfg.DevFundAddress = fund.Hex()

	if devChain(cfg) {
		t.Fatal("the development chain is on without PARALLAX_DEV")
	}
	t.Setenv("PARALLAX_DEV", "1")

	cfg.DevFundAddress = "0x123"
	if err := ValidateConfig(cfg); err == nil {
		t.Fatal("a malformed funded address passed validation")
	}
	cfg.DevFundAddress = fund.Hex()

	store, err := LoadConfigStore(filepath.Join(t.TempDir(), "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	n := NewNodeController(store)
	if err := n.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer n.Stop()

	st := n.Status()
	if !st.DevChain || st.Syncing || st.ChainID != 1337 || st.NetworkID != devNetworkID {
		t.Fatalf("status = %+v, want a synced development chain 1337", st)
	}
	if want := filepath.Join(cfg.DataDir+"-dev", "0x809934fd0543ace5621082125162e6899544af46"); st.DataDir != want {
		t.Fatalf("data directory = %s, want %s", st.DataDir, want)
	}
	state, err := n.Parallax().BlockChain().State()
	if err != nil {
		t.Fatal(err)
	}
	if got := state.GetBalance(fund); got.Cmp(devFunds) != 0 {
		t.Fatalf("funded balance = %v, want %v", got, devFunds)
	}
	if !n.Parallax().IsMining() {
		t.Fatal("the development chain is not sealing")
	}
}
