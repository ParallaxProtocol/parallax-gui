// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// mainnetRequest is a valid request for Parallax mainnet, as a map to tamper
// with field by field.
func mainnetRequest(t *testing.T) map[string]interface{} {
	t.Helper()
	from := util.HexToAddress(bobAddr)
	tx := types.NewTransaction(7, util.HexToAddress(aliceAddr), big.NewInt(1e18), 21000, big.NewInt(1e9), nil)
	req := newSignRequest(chainparams.MainnetChainConfig.ChainID, from, tx, "rent", time.Unix(1791965000, 0))
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(req.Doc), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func encode(m map[string]interface{}) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func TestSignRequestFormat(t *testing.T) {
	m := mainnetRequest(t)
	req, err := parseSignRequest(encode(m), defaultFeeCapWei)
	if err != nil {
		t.Fatal(err)
	}
	if req.view.Nonce != 7 || req.view.To != aliceAddr || req.view.ValueWei != "1000000000000000000" || req.view.MaxFeeWei != "21000000000000" {
		t.Fatalf("parsed %+v", req.view)
	}
	if fp := Fingerprint(req.view.ID); len(fp) != 9 || fp[4] != '-' || fp != strings.ToUpper(fp) {
		t.Fatalf("fingerprint %q", fp)
	}
	// Decimal strings throughout, as the spec says
	for _, k := range []string{"chainId", "nonce", "valueWei", "gasLimit", "gasPriceWei"} {
		if _, ok := m[k].(string); !ok {
			t.Fatalf("%s is %T, want a decimal string", k, m[k])
		}
	}

	bad := []struct {
		name string
		edit func(m map[string]interface{})
		want error
	}{
		{"not a request", func(m map[string]interface{}) { m["type"] = "something" }, ErrRequestFormat},
		{"newer version", func(m map[string]interface{}) { m["version"] = 2 }, ErrRequestVersion},
		{"other chain", func(m map[string]interface{}) { m["chainId"] = "1" }, ErrRequestChain},
		{"dev chain outside dev builds", func(m map[string]interface{}) { m["chainId"] = "1337" }, ErrRequestChain},
		{"bad checksum", func(m map[string]interface{}) { m["to"] = "0x809934FD0543aCe5621082125162e6899544aF46" }, ErrBadChecksum},
		{"zero recipient", func(m map[string]interface{}) { m["to"] = "0x0000000000000000000000000000000000000000" }, ErrBadRecipient},
		{"call data", func(m map[string]interface{}) { m["data"] = "0xa9059cbb" }, ErrRequestData},
		{"hex nonce", func(m map[string]interface{}) { m["nonce"] = "0x7" }, ErrRequestFormat},
		{"negative value", func(m map[string]interface{}) { m["valueWei"] = "-1" }, ErrRequestFormat},
		{"huge value", func(m map[string]interface{}) { m["valueWei"] = "1" + strings.Repeat("0", 80) }, ErrRequestFormat},
		{"gas below a transfer", func(m map[string]interface{}) { m["gasLimit"] = "20999" }, ErrRequestGas},
		{"gas too high", func(m map[string]interface{}) { m["gasLimit"] = "30000001" }, ErrRequestGas},
		{"free gas", func(m map[string]interface{}) { m["gasPriceWei"] = "0" }, ErrRequestGas},
		{"fee over the cap", func(m map[string]interface{}) { m["gasPriceWei"] = "100000000000000" }, ErrRequestFeeCap},
		{"long memo", func(m map[string]interface{}) { m["memo"] = strings.Repeat("é", 201) }, ErrRequestMemo},
		{"tampered value", func(m map[string]interface{}) { m["valueWei"] = "2000000000000000000" }, ErrRequestTampered},
		{"tampered recipient", func(m map[string]interface{}) { m["to"] = carolAddr }, ErrRequestTampered},
	}
	for _, c := range bad {
		m := mainnetRequest(t)
		c.edit(m)
		if _, err := parseSignRequest(encode(m), defaultFeeCapWei); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}
	// The memo isn't signed: changing it keeps the request valid
	m = mainnetRequest(t)
	m["memo"] = "something else"
	if _, err := parseSignRequest(encode(m), defaultFeeCapWei); err != nil {
		t.Fatalf("memo change: %v", err)
	}
	// A raised cap takes a dearer fee
	m = mainnetRequest(t)
	m["gasPriceWei"] = "100000000000000"
	m["id"] = types.LatestSignerForChainID(chainparams.MainnetChainConfig.ChainID).Hash(
		types.NewTransaction(7, util.HexToAddress(aliceAddr), big.NewInt(1e18), 21000, big.NewInt(1e14), nil)).Hex()
	if _, err := parseSignRequest(encode(m), new(big.Int).Mul(defaultFeeCapWei, big.NewInt(3))); err != nil {
		t.Fatalf("under a raised cap: %v", err)
	}
	if _, err := parseSignRequest(strings.Repeat(" ", maxOfflineDoc+1), defaultFeeCapWei); !errors.Is(err, ErrRequestFormat) {
		t.Fatalf("oversized: %v", err)
	}
}

// TestOfflineSigningEndToEnd runs the whole flow on the development chain:
// an online wallet follows a watch-only account whose key is in a signer
// wallet that has no node at all.
func TestOfflineSigningEndToEnd(t *testing.T) {
	t.Setenv("PARALLAX_DEV", "1")

	// The signer: a wallet with the key, never a node
	signer, _ := newTestWallet(t)
	key, err := signer.Create("Cold", testPassword)
	if err != nil {
		t.Fatal(err)
	}

	// The online side: the development chain funds the signer's account
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(t.TempDir(), "parallax")
	cfg.HTTPRPCEnabled, cfg.IPCDisabled = false, true
	cfg.DevChain, cfg.DevFundAddress = true, key.Address
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
	online, _ := newTestWallet(t)
	online.node = n

	watch, err := online.AddWatchOnly("Cold (watch)", strings.ToLower(key.Address))
	if err != nil {
		t.Fatal(err)
	}
	if !watch.WatchOnly || watch.Address != key.Address {
		t.Fatalf("watch-only account %+v", watch)
	}
	if _, err := online.AddWatchOnly("", key.Address); !errors.Is(err, ErrAccountExists) {
		t.Fatalf("adding it twice: %v", err)
	}
	if _, err := online.Send(SendRequest{From: key.Address, To: aliceAddr, ValueWei: "1", GasPriceWei: "1000000000", GasLimit: 21000, Password: testPassword}); !errors.Is(err, ErrWatchOnly) {
		t.Fatalf("a direct send from a watch-only account: %v", err)
	}

	value := big.NewInt(3e18)
	in := OfflineRequestInput{From: key.Address, To: aliceAddr, ValueWei: value.String(), GasPriceWei: "1000000000", GasLimit: 21000, Memo: "rent"}
	req, err := online.BuildRequest(in)
	if err != nil {
		t.Fatal(err)
	}
	// A second request takes the next nonce
	req2, err := online.BuildRequest(in)
	if err != nil {
		t.Fatal(err)
	}
	if req.Tx.Nonce != 0 || req2.Tx.Nonce != 1 {
		t.Fatalf("nonces %d, %d; want 0, 1", req.Tx.Nonce, req2.Tx.Nonce)
	}
	if err := online.DiscardRequest(req2.Tx.ID); err != nil {
		t.Fatal(err)
	}

	// The signer reviews and signs it; the same request again is "signed",
	// a different one for the same nonce a conflict
	rev, err := signer.ReviewRequest(req.Doc)
	if err != nil {
		t.Fatal(err)
	}
	if rev.Tx.ID != req.Tx.ID || rev.Tx.Memo != "rent" || rev.Conflict || rev.Signed {
		t.Fatalf("review %+v", rev)
	}
	if _, err := signer.SignRequest(req.Doc, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	signed, err := signer.SignRequest(req.Doc, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := signer.SignRequest(req.Doc, testPassword); again.Doc != signed.Doc {
		t.Fatal("signing the same request twice gave different transactions")
	}
	if rev, _ := signer.ReviewRequest(req.Doc); !rev.Signed || rev.Conflict {
		t.Fatalf("after signing: %+v", rev)
	}
	other, err := online.ReplaceRequest(req.Tx.ID)
	if err != nil {
		t.Fatal(err)
	}
	if other.Tx.Nonce != req.Tx.Nonce || other.Tx.To != key.Address || other.Tx.ValueWei != "0" {
		t.Fatalf("replacement %+v", other.Tx)
	}
	if rev, _ := signer.ReviewRequest(other.Doc); !rev.Conflict {
		t.Fatal("a different transfer for a signed nonce gave no warning")
	}
	// A signer without the key refuses
	stranger, _ := newTestWallet(t)
	if _, err := stranger.ReviewRequest(req.Doc); !errors.Is(err, ErrRequestAccount) {
		t.Fatalf("a signer without the key: %v", err)
	}

	// Back online: the signed document must answer its request exactly
	var doc map[string]interface{}
	json.Unmarshal([]byte(signed.Doc), &doc)
	doc["id"] = req2.Tx.ID
	if _, err := online.ReviewSigned(encode(doc)); !errors.Is(err, ErrSignedMismatch) {
		t.Fatalf("a signature passed off as another request's: %v", err)
	}
	srev, err := online.ReviewSigned(signed.Doc)
	if err != nil {
		t.Fatal(err)
	}
	if !srev.Matched || srev.Tx.Memo != "rent" || srev.Hash != signed.Hash || srev.Tx.From != key.Address {
		t.Fatalf("signed review %+v", srev)
	}
	sent, err := online.Broadcast(signed.Doc)
	if err != nil {
		t.Fatal(err)
	}

	// Sealed into a block: the request is done, the replacement stale, and
	// the same transaction can't go out again
	deadline := time.Now().Add(10 * time.Second)
	for {
		st, _ := n.Parallax().BlockChain().State()
		if st.GetNonce(util.HexToAddress(key.Address)) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the broadcast transaction was never sealed")
		}
		time.Sleep(50 * time.Millisecond)
	}
	pending, err := online.PendingRequests()
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Tx.ID != other.Tx.ID || pending[0].Status != "stale" {
		t.Fatalf("pending after the block %+v", pending)
	}
	if _, err := online.ReviewSigned(signed.Doc); !errors.Is(err, ErrSignedNonceUsed) {
		t.Fatalf("broadcasting it again: %v", err)
	}
	if d, err := n.TxDetails(sent.Hash); err != nil || d.Status != "success" || d.ValueWei != value.String() {
		t.Fatalf("the sent transaction %+v, %v", d, err)
	}

	// A bare raw transaction (as parallax-wallet signtx prints) is taken too
	req3, err := online.BuildRequest(in)
	if err != nil {
		t.Fatal(err)
	}
	signed3, _ := signer.SignRequest(req3.Doc, testPassword)
	var d3 SignedTxDoc
	json.Unmarshal([]byte(signed3.Doc), &d3)
	if rev, err := online.ReviewSigned(d3.Raw); err != nil || !rev.Matched {
		t.Fatalf("bare raw: %+v, %v", rev, err)
	}

	// The real CLI, when built, signs the GUI's request to the same bytes
	if bin := os.Getenv("PARALLAX_WALLET_BIN"); bin != "" {
		keyfile := filepath.Join(signer.dir, mustKeyfile(t, signer.dir))
		reqFile := filepath.Join(t.TempDir(), "request.json")
		os.WriteFile(reqFile, []byte(req3.Doc), 0o600)
		pw := filepath.Join(t.TempDir(), "pw")
		os.WriteFile(pw, []byte(testPassword), 0o600)
		out, err := exec.Command(bin, "signrequest", "--chainid", "1337", "--yes", "--passwordfile", pw, keyfile, reqFile).Output()
		if err != nil {
			t.Fatalf("parallax-wallet signrequest: %v", err)
		}
		var cli SignedTxDoc
		if err := json.Unmarshal(out, &cli); err != nil {
			t.Fatalf("CLI output %s: %v", out, err)
		}
		if cli.Raw != d3.Raw || cli.Hash != d3.Hash || !strings.EqualFold(cli.ID, d3.ID) {
			t.Fatalf("CLI signed %+v, the GUI %+v", cli, d3)
		}
		if rev, err := online.ReviewSigned(string(out)); err != nil || !rev.Matched {
			t.Fatalf("the CLI's document: %+v, %v", rev, err)
		}
	}
}

func mustKeyfile(t *testing.T, dir string) string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "UTC--") {
			return e.Name()
		}
	}
	t.Fatal("no keyfile")
	return ""
}

func TestOfflineSignerNeverStartsTheNode(t *testing.T) {
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(t.TempDir(), "parallax")
	cfg.OfflineSigner = true
	store, _ := LoadConfigStore(filepath.Join(t.TempDir(), "gui.json"))
	store.Save(cfg)
	n := NewNodeController(store)
	if err := n.Start(context.Background()); !errors.Is(err, ErrOfflineSigner) {
		t.Fatalf("Start in offline mode: %v", err)
	}
	if n.Stack() != nil {
		t.Fatal("a node is running")
	}

	cfg.OfflineFeeCapWei = "0"
	if err := ValidateConfig(cfg); !errors.Is(err, ErrOfflineFeeCap) {
		t.Fatalf("a zero fee cap: %v", err)
	}
	cfg.OfflineFeeCapWei = "1.5"
	if err := ValidateConfig(cfg); !errors.Is(err, ErrOfflineFeeCap) {
		t.Fatalf("a fractional wei cap: %v", err)
	}
}
