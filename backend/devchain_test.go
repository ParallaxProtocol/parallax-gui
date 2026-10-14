// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"math/big"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
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

	// A transfer from the signer to a wallet account is sealed into a block
	// of its own; TxDetails reads it from the pool and then from the chain,
	// and WalletActivity reports it to the watch started before it
	w, _ := newTestWallet(t)
	w.node = n
	acc, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	recv := util.HexToAddress(acc.Address)
	if txs, head, err := w.WalletActivity(0); err != nil || len(txs) != 0 || head != 0 {
		t.Fatalf("activity at genesis = %v, %d, %v; want nothing, at head 0", txs, head, err)
	}
	ks := n.Stack().AccountManager().Backends(keystore.KeyStoreType)[0].(*keystore.KeyStore)
	signer := ks.Accounts()[0]
	chainID := n.Parallax().BlockChain().Config().ChainID
	value := big.NewInt(1e18)
	tx, err := ks.SignTx(signer, types.NewTransaction(0, recv, value, 21000, big.NewInt(1e9), nil), chainID)
	if err != nil {
		t.Fatal(err)
	}
	if err := n.Parallax().TxPool().AddLocal(tx); err != nil {
		t.Fatal(err)
	}
	var d TxDetails
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(50 * time.Millisecond) {
		if d, err = n.TxDetails(tx.Hash().Hex()); err != nil {
			t.Fatal(err)
		}
		if d.Status != "pending" || time.Now().After(deadline) {
			break
		}
	}
	if d.Status != "success" || d.Block != 1 || d.GasUsed != 21000 || d.Timestamp == 0 {
		t.Fatalf("details = %+v, want a successful transfer in block 1", d)
	}
	if d.From != signer.Address.Hex() || d.To != recv.Hex() || d.ValueWei != value.String() || d.Input != "0x" {
		t.Fatalf("details = %+v, want %s → %s of %s", d, signer.Address.Hex(), recv.Hex(), value)
	}
	if want := new(big.Int).Mul(new(big.Int).SetUint64(d.GasUsed), mustBig(t, d.GasPriceWei)); d.FeeWei != want.String() {
		t.Fatalf("fee = %s, want gas used × price = %s", d.FeeWei, want)
	}
	txs, head, err := w.WalletActivity(0)
	if err != nil || head != 1 || len(txs) != 1 || txs[0].Hash != tx.Hash().Hex() || txs[0].To != recv.Hex() || txs[0].Failed {
		t.Fatalf("activity after genesis = %+v, %d, %v; want the transfer, at head 1", txs, head, err)
	}
	if txs, _, err := w.WalletActivity(1); err != nil || len(txs) != 0 {
		t.Fatalf("activity after block 1 = %v, %v; want none", txs, err)
	}
	if b, err := w.Balances(); err != nil || len(b) != 1 || b[recv.Hex()] != value.String() {
		t.Fatalf("balances = %v, %v; want %s holding %s", b, err, recv.Hex(), value)
	}
	if _, err := n.TxDetails("0x1234"); err == nil {
		t.Fatal("a malformed hash was looked up")
	}
}

func mustBig(t *testing.T, s string) *big.Int {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("%q is not a number", s)
	}
	return v
}

// TestProfiles keeps each development profile's state apart, and release
// builds out of them.
func TestProfiles(t *testing.T) {
	t.Setenv("PARALLAX_PROFILE", "signer")
	t.Setenv("PARALLAX_DEV", "")
	if Profile() != "" || appDirName() != "Parallax" {
		t.Fatal("a release build took a profile")
	}
	t.Setenv("PARALLAX_DEV", "1")
	if Profile() != "signer" || appDirName() != "Parallax-signer" {
		t.Fatalf("profile %q, folder %q", Profile(), appDirName())
	}
	if d := defaultGUIConfig().DataDir; !strings.HasSuffix(d, "-signer") {
		t.Fatalf("the profile's node data folder %s isn't its own", d)
	}
	for _, bad := range []string{"../x", "Signer", "-x", "a b", strings.Repeat("a", 33)} {
		t.Setenv("PARALLAX_PROFILE", bad)
		if Profile() != "" {
			t.Errorf("profile %q was taken", bad)
		}
	}
}
