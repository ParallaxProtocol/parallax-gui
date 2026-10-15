// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
	"github.com/tyler-smith/go-bip39"
)

func TestSealedFilesOpenOnlyAsSealed(t *testing.T) {
	key := bytes.Repeat([]byte{7}, walletKeyLen)
	other := bytes.Repeat([]byte{8}, walletKeyLen)
	sealed, err := sealWith(key, sealedMeta, []byte(`{"names":{"0xabc":"Savings"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("Savings")) {
		t.Fatal("sealed in the clear")
	}
	if plain, err := openWith(key, sealedMeta, sealed); err != nil || !bytes.Contains(plain, []byte("Savings")) {
		t.Fatalf("open = %q, %v", plain, err)
	}
	// Under another key, as another file, or changed by a byte, it won't open
	if _, err := openWith(other, sealedMeta, sealed); !errors.Is(err, errSealed) {
		t.Errorf("another key: %v", err)
	}
	if _, err := openWith(key, sealedContacts, sealed); !errors.Is(err, errSealed) {
		t.Errorf("another file's name: %v", err)
	}
	tampered := append([]byte{}, sealed...)
	tampered[len(tampered)-1] ^= 1
	if _, err := openWith(key, sealedMeta, tampered); !errors.Is(err, errSealed) {
		t.Errorf("tampered: %v", err)
	}
	// Each seal is fresh: the same file twice shares nothing a reader could match
	again, _ := sealWith(key, sealedMeta, []byte(`{"names":{"0xabc":"Savings"}}`))
	if bytes.Equal(sealed, again) {
		t.Error("two seals of the same file are the same")
	}
}

func TestLockedWalletTellsNothing(t *testing.T) {
	w, _ := newTestWallet(t)
	acc, err := w.Create("Savings", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.AddWatchOnly("Cold", bobAddr); err != nil {
		t.Fatal(err)
	}
	w.Lock()
	info := w.Info()
	if !info.Locked || !info.HasPassword || len(info.Accounts) != 0 || len(info.Seeds) != 0 || info.Selected != "" {
		t.Fatalf("locked Info = %+v, want locked and empty", info)
	}
	if len(w.addresses()) != 0 {
		t.Fatal("a locked wallet lists its addresses")
	}
	if err := w.Rename(acc.Address, "Other"); !errors.Is(err, ErrLocked) {
		t.Fatalf("Rename while locked = %v, want ErrLocked", err)
	}
	if _, err := w.Summary(acc.Address); !errors.Is(err, ErrLocked) {
		t.Fatalf("Summary while locked = %v, want ErrLocked", err)
	}
	if err := w.Unlock("wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Unlock with the wrong password = %v", err)
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	info = w.Info()
	if len(info.Accounts) != 2 || info.Accounts[0].Name != "Savings" || info.Accounts[1].Name != "Cold" {
		t.Fatalf("unlocked Info = %+v, want both accounts by name", info.Accounts)
	}
}

func TestChangePasswordKeepsWhatsSealed(t *testing.T) {
	w, _ := newTestWallet(t)
	if _, err := w.Create("Savings", testPassword); err != nil {
		t.Fatal(err)
	}
	const next = "another long password"
	if err := w.ChangePassword(testPassword, next); err != nil {
		t.Fatal(err)
	}
	w.Lock()
	if err := w.Unlock(testPassword); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("the old password still unlocks: %v", err)
	}
	if err := w.Unlock(next); err != nil {
		t.Fatal(err)
	}
	if info := w.Info(); len(info.Accounts) != 1 || info.Accounts[0].Name != "Savings" {
		t.Fatalf("after the change, Info = %+v", info.Accounts)
	}
}

func TestUnlockSealsAnEarlierVersionsWallet(t *testing.T) {
	n, p := walletScryptN, walletScryptP
	walletScryptN, walletScryptP = keystore.LightScryptN, keystore.LightScryptP
	t.Cleanup(func() { walletScryptN, walletScryptP = n, p })
	dir := t.TempDir()

	// What a vault of format 1 kept: a check, a phrase with its fingerprint,
	// and beside it the labels and the signing records in the clear
	ks := keystore.NewKeyStore(filepath.Join(dir, "keystore"), keystore.LightScryptN, keystore.LightScryptP)
	acc, err := ks.NewAccount(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	check, err := encrypt(bytes.Repeat([]byte{1}, 32), testPassword)
	if err != nil {
		t.Fatal(err)
	}
	entropy, err := encrypt(bytes.Repeat([]byte{2}, 16), testPassword)
	if err != nil {
		t.Fatal(err)
	}
	v1, _ := json.Marshal(map[string]any{
		"version": 1, "check": check,
		"seeds": []map[string]any{{"id": "s1", "entropy": entropy, "fingerprint": bobAddr}},
	})
	writeFile(t, filepath.Join(dir, vaultFileName), string(v1))
	meta, _ := json.Marshal(walletMeta{
		Names:  map[string]string{acc.Address.Hex(): "Savings"},
		Seeds:  map[string]seedMeta{"s1": {Name: "Mine"}},
		Watch:  []string{carolAddr},
		SeedOf: map[string]seedRef{},
	})
	writeFile(t, filepath.Join(dir, "wallet.json"), string(meta))
	writeFile(t, filepath.Join(dir, "requests.json"), `[]`)
	writeFile(t, filepath.Join(dir, "signed.json"), `[]`)

	w, err := NewWallet(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	waitForAccounts(t, w, 1)
	if info := w.Info(); !info.Locked || len(info.Accounts) != 0 {
		t.Fatalf("before unlock, Info = %+v", info)
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	info := w.Info()
	if len(info.Accounts) != 2 || info.Accounts[0].Name != "Savings" || len(info.Seeds) != 1 || info.Seeds[0].Name != "Mine" {
		t.Fatalf("after the upgrade, Info = %+v", info)
	}

	for _, name := range []string{"wallet.json", "requests.json", "signed.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s is still in the clear", name)
		}
	}
	for _, name := range []string{sealedMeta, sealedRequests, sealedSigned} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || !bytes.HasPrefix(data, sealMagic) {
			t.Errorf("%s isn't sealed: %v", name, err)
		}
	}
	v, err := w.loadVault()
	if err != nil || v.Version != vaultFormat || v.Key == nil || v.Check != nil || len(v.LogPublic) != 32 {
		t.Fatalf("vault after the upgrade = %+v, %v", v, err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, vaultFileName))
	if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(bobAddr[2:])) {
		t.Fatal("the vault still names the phrase's fingerprint")
	}
	w.mu.Lock()
	fp := w.meta.Seeds["s1"].Fingerprint
	w.mu.Unlock()
	if fp != bobAddr {
		t.Fatalf("the fingerprint sealed with the labels = %q, want %s", fp, bobAddr)
	}

	// And it opens again as format 2
	w.Lock()
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	if info := w.Info(); len(info.Accounts) != 2 {
		t.Fatalf("reopened, Info = %+v", info.Accounts)
	}
}

func TestRecordPendingReplacesBySenderAndNonce(t *testing.T) {
	w, _ := newTestWallet(t)
	from := util.HexToAddress(aliceAddr)
	to := util.HexToAddress(bobAddr)
	first := types.NewTransaction(4, to, big.NewInt(1), 21000, big.NewInt(1), nil)
	faster := types.NewTransaction(4, to, big.NewInt(1), 21000, big.NewInt(2), nil)
	other := types.NewTransaction(5, to, big.NewInt(1), 21000, big.NewInt(1), nil)
	w.recordPending(first, from)
	w.recordPending(other, from)
	w.recordPending(faster, from)
	var list []pendingSend
	if _, err := w.ReadSealed(w.pendingPath(), sealedPending, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Nonce != 5 || list[1].Hash != faster.Hash().Hex() {
		t.Fatalf("kept %+v, want nonce 5 and the faster nonce 4", list)
	}
	raw, _ := os.ReadFile(w.pendingPath())
	if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(aliceAddr[2:])) {
		t.Fatal("the kept sends are in the clear")
	}
	// Locked, nothing is kept: there's no key to seal with
	w.Lock()
	w.recordPending(other, from)
	if _, err := w.ReadSealed(w.pendingPath(), sealedPending, &list); !errors.Is(err, ErrLocked) {
		t.Fatalf("read while locked = %v, want ErrLocked", err)
	}
}

// damage flips a byte at the end of the file at path.
func damage(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDamagedLabelsFallBackToTheirLastCopy(t *testing.T) {
	w, dir := newTestWallet(t)
	acc, err := w.Create("Savings", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Rename(acc.Address, "Main"); err != nil {
		t.Fatal(err)
	}
	w.Lock()
	damage(t, filepath.Join(dir, sealedMeta))
	if err := w.Unlock(testPassword); err != nil {
		t.Fatalf("Unlock over damaged labels = %v, want it to open", err)
	}
	info := w.Info()
	if len(info.Accounts) != 1 || info.Accounts[0].Name != "Savings" {
		t.Fatalf("Info = %+v, want the last copy's name", info.Accounts)
	}
	if len(info.Damaged) != 1 || info.Damaged[0] != "labels" {
		t.Fatalf("Damaged = %v, want [labels]", info.Damaged)
	}
	if aside, _ := filepath.Glob(filepath.Join(dir, sealedMeta+".damaged-*")); len(aside) != 1 {
		t.Fatalf("set aside = %v, want the damaged file kept", aside)
	}
	w.DismissDamaged()
	if d := w.Info().Damaged; len(d) != 0 {
		t.Fatalf("Damaged after dismissing = %v", d)
	}
}

func TestDamagedLabelsWithoutACopyStillUnlock(t *testing.T) {
	w, dir := newTestWallet(t)
	acc, err := w.Create("Savings", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	w.Lock()
	damage(t, filepath.Join(dir, sealedMeta))
	if err := w.Unlock(testPassword); err != nil {
		t.Fatalf("Unlock = %v", err)
	}
	// The name is gone; the key isn't
	info := w.Info()
	if len(info.Accounts) != 1 || info.Accounts[0].Address != acc.Address || info.Accounts[0].Name != "" {
		t.Fatalf("Info = %+v, want the account, unnamed", info.Accounts)
	}
	if _, err := w.Backup(acc.Address, testPassword); err != nil {
		t.Fatalf("the key no longer opens: %v", err)
	}
}

func TestDamagedVaultFallsBackToItsLastCopy(t *testing.T) {
	w, dir := newTestWallet(t)
	if _, err := w.Create("Savings", testPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := w.CreateSeed("Mine", testPassword, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, vaultFileName+".1")); err != nil {
		t.Fatalf("adding a phrase kept no previous vault: %v", err)
	}
	w.Lock()
	if err := os.WriteFile(filepath.Join(dir, vaultFileName), []byte("{damaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatalf("Unlock over a damaged vault = %v", err)
	}
	if d := w.Info().Damaged; len(d) == 0 || d[0] != "vault" {
		t.Fatalf("Damaged = %v, want the vault", d)
	}
}

func TestVaultKeepsNoCopyUnderAnOldPasswordOrARemovedPhrase(t *testing.T) {
	w, dir := newTestWallet(t)
	prev := filepath.Join(dir, vaultFileName+".1")
	phrase, err := w.CreateSeed("Mine", testPassword, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := w.RemoveSeed(phrase.SeedID, testPassword); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(prev); !os.IsNotExist(err) {
		t.Fatalf("a previous vault, with the removed phrase, is still there: %v", err)
	}
	if _, err := w.CreateSeed("Again", testPassword, ""); err != nil {
		t.Fatal(err)
	}
	if err := w.ChangePassword(testPassword, "another long password"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(prev); !os.IsNotExist(err) {
		t.Fatalf("a previous vault, under the old password, is still there: %v", err)
	}
}

func TestUnlockDropsThePhrasesKeyFiles(t *testing.T) {
	w, dir := newTestWallet(t)
	phrase, err := w.CreateSeed("Mine", testPassword, "")
	if err != nil {
		t.Fatal(err)
	}
	addr := util.HexToAddress(phrase.Account.Address)
	// As an earlier version kept it: the derived key in the keystore too
	entropy, err := bip39.EntropyFromMnemonic(strings.Join(phrase.Words, " "))
	if err != nil {
		t.Fatal(err)
	}
	path, _ := wallet.ParseDerivationPath(phrase.Account.SeedPath)
	priv, err := deriveKey(entropy, "", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.keys().ImportECDSA(priv, testPassword); err != nil {
		t.Fatal(err)
	}
	w.Lock()
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	if w.keys().HasAddress(addr) {
		t.Fatal("the phrase account's key file is still there")
	}
	files, _ := os.ReadDir(filepath.Join(dir, "keystore"))
	for _, f := range files {
		if strings.Contains(strings.ToLower(f.Name()), strings.ToLower(addr.Hex()[2:])) {
			t.Fatalf("a key file still names the phrase account: %s", f.Name())
		}
	}
	info := w.Info()
	if len(info.Accounts) != 1 || info.Accounts[0].Address != addr.Hex() || !info.Accounts[0].FromSeed {
		t.Fatalf("Info = %+v, want the phrase's account", info.Accounts)
	}
	if _, err := w.SignMessage(addr.Hex(), "hello", testPassword); err != nil {
		t.Fatalf("the phrase account no longer signs: %v", err)
	}
}
