package backend

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
)

// The well-known development phrase and the accounts every BIP-44 wallet
// (MetaMask, Hardhat, Foundry) derives from it at m/44'/60'/0'/0/n.
const devPhrase = "test test test test test test test test test test test junk"

var devAccounts = []string{
	"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
	"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
	"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
}

// BIP-39's own test vector: all-zero entropy, passphrase "TREZOR".
const (
	abandonPhrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	trezorSeed    = "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"
)

func addrAt(t *testing.T, words, passphrase string, scheme string, index uint32) string {
	t.Helper()
	entropy, err := entropyFromWords(words)
	if err != nil {
		t.Fatal(err)
	}
	pass, err := normPassphrase(passphrase)
	if err != nil {
		t.Fatal(err)
	}
	path, err := schemePath(scheme, index)
	if err != nil {
		t.Fatal(err)
	}
	addr, err := deriveAddress(entropy, pass, path)
	if err != nil {
		t.Fatal(err)
	}
	return addr
}

func TestDeriveKeyMatchesOtherWallets(t *testing.T) {
	for i, want := range devAccounts {
		if got := addrAt(t, devPhrase, "", SchemeStandard, uint32(i)); got != want {
			t.Errorf("account %d = %s, want %s", i, got, want)
		}
	}
	if got := addrAt(t, abandonPhrase, "", SchemeStandard, 0); got != "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" {
		t.Errorf("abandon…about account 0 = %s", got)
	}
}

func TestPassphraseFollowsBIP39(t *testing.T) {
	// The account a passphrase gives is the one BIP-39's published seed gives
	seed, _ := hex.DecodeString(trezorSeed)
	key, err := hdkeychain.NewMaster(seed, &chaincfg.MainNetParams)
	if err != nil {
		t.Fatal(err)
	}
	path, _ := schemePath(SchemeStandard, 0)
	for _, step := range path {
		if key, err = key.Derive(step); err != nil {
			t.Fatal(err)
		}
	}
	ec, _ := key.ECPrivKey()
	priv, _ := crypto.ToECDSA(ec.Serialize())
	want := crypto.PubkeyToAddress(priv.PublicKey).Hex()
	if got := addrAt(t, abandonPhrase, "TREZOR", SchemeStandard, 0); got != want {
		t.Fatalf("with passphrase TREZOR = %s, want %s", got, want)
	}
	if addrAt(t, abandonPhrase, "", SchemeStandard, 0) == want {
		t.Fatal("the passphrase changed nothing")
	}
	// Composed and decomposed accents are one passphrase (NFKD), as on hardware wallets
	if addrAt(t, devPhrase, "café", SchemeStandard, 0) != addrAt(t, devPhrase, "café", SchemeStandard, 0) {
		t.Fatal("the passphrase isn't normalised")
	}
}

func TestEntropyFromWords(t *testing.T) {
	for _, bad := range []string{
		"",
		"test test test test test test test test test test test test", // checksum fails
		"test test test test test test test test test test junk",      // 11 words
		"test test test test test test test test test test test jnuk", // not a word
	} {
		if _, err := entropyFromWords(bad); !errors.Is(err, ErrBadMnemonic) {
			t.Errorf("entropyFromWords(%q) = %v, want ErrBadMnemonic", bad, err)
		}
	}
	// Any case and spacing, as people type
	if _, err := entropyFromWords("  TEST test\ttest test test test test test test test test\n Junk "); err != nil {
		t.Fatalf("a valid phrase typed loosely was refused: %v", err)
	}
}

func TestSeedLifecycle(t *testing.T) {
	w, dir := newTestWallet(t)
	phrase, err := w.CreateSeed("Main", testPassword, "")
	if err != nil {
		t.Fatalf("CreateSeed: %v", err)
	}
	a := phrase.Account
	if len(phrase.Words) != 12 || phrase.SeedID == "" || !a.FromSeed || a.SeedID != phrase.SeedID || !a.SeedStandard || a.SeedIndex != 0 || a.BackedUp {
		t.Fatalf("CreateSeed = %+v", phrase)
	}
	info := w.Info()
	if len(info.Seeds) != 1 || info.Seeds[0].Confirmed || info.Seeds[0].Accounts != 1 || info.Seeds[0].HasPassphrase {
		t.Fatalf("Info.Seeds = %+v", info.Seeds)
	}

	// Only encrypted phrases are on disk
	raw, _ := os.ReadFile(filepath.Join(dir, "vault.json"))
	for _, word := range phrase.Words {
		if strings.Contains(string(raw), `"`+word+`"`) {
			t.Fatal("vault.json holds a word of the phrase")
		}
	}
	if addrAt(t, strings.Join(phrase.Words, " "), "", SchemeStandard, 0) != a.Address {
		t.Fatal("the phrase doesn't derive its own first account")
	}

	if _, err := w.RevealSeed(phrase.SeedID, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("RevealSeed(wrong) = %v", err)
	}
	if _, err := w.RevealSeed("nope", testPassword); !errors.Is(err, ErrUnknownSeed) {
		t.Fatalf("RevealSeed(unknown) = %v", err)
	}
	shown, err := w.RevealSeed(phrase.SeedID, testPassword)
	if err != nil || strings.Join(shown.Words, " ") != strings.Join(phrase.Words, " ") || shown.Passphrase != "" {
		t.Fatalf("RevealSeed = %+v, %v", shown, err)
	}

	next, err := w.DeriveAccount(phrase.SeedID, "Second", testPassword)
	if err != nil || next.SeedID != phrase.SeedID || next.SeedIndex != 1 {
		t.Fatalf("DeriveAccount = %+v, %v", next, err)
	}
	if _, err := w.DeriveAccount(phrase.SeedID, "", "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("DeriveAccount(wrong) = %v", err)
	}
	if _, err := w.Backup(next.Address, testPassword); err != nil {
		t.Fatalf("derived account's key doesn't open with the wallet password: %v", err)
	}

	if err := w.ConfirmSeed(phrase.SeedID); err != nil {
		t.Fatal(err)
	}
	for _, acc := range w.Info().Accounts {
		if !acc.BackedUp {
			t.Fatalf("%s from a confirmed phrase isn't backed up", acc.Address)
		}
	}
	if err := w.RenameSeed(phrase.SeedID, "Savings words"); err != nil || w.Info().Seeds[0].Name != "Savings words" {
		t.Fatalf("RenameSeed: %v, %+v", err, w.Info().Seeds)
	}

	// Removing an account leaves the phrase, and the next index moves on
	if err := w.Remove(next.Address, testPassword); err != nil {
		t.Fatal(err)
	}
	third, err := w.DeriveAccount(phrase.SeedID, "", testPassword)
	if err != nil || third.SeedIndex != 2 {
		t.Fatalf("DeriveAccount after Remove = %+v, %v", third, err)
	}
}

func TestSeveralPhrases(t *testing.T) {
	w, _ := newTestWallet(t)
	mine, err := w.CreateSeed("", testPassword, "")
	if err != nil {
		t.Fatal(err)
	}
	dev, err := w.ImportSeed("Dev", devPhrase, "", testPassword, nil)
	if err != nil || dev.Address != devAccounts[0] || !dev.BackedUp {
		t.Fatalf("ImportSeed = %+v, %v", dev, err)
	}
	// The same phrase and passphrase again is refused; another passphrase is another wallet
	if _, err := w.ImportSeed("", devPhrase, "", testPassword, nil); !errors.Is(err, ErrSeedExists) {
		t.Fatalf("same phrase again = %v, want ErrSeedExists", err)
	}
	hidden, err := w.ImportSeed("", devPhrase, "hidden", testPassword, nil)
	if err != nil || hidden.Address == devAccounts[0] {
		t.Fatalf("phrase with a passphrase = %+v, %v", hidden, err)
	}
	info := w.Info()
	if len(info.Seeds) != 3 || !info.Seeds[2].HasPassphrase || info.Seeds[0].Name == info.Seeds[1].Name {
		t.Fatalf("Info.Seeds = %+v", info.Seeds)
	}

	// Each phrase keeps its own count
	devNext, err := w.DeriveAccount(dev.SeedID, "", testPassword)
	if err != nil || devNext.Address != devAccounts[1] {
		t.Fatalf("DeriveAccount(dev) = %+v, %v", devNext, err)
	}
	mineNext, err := w.DeriveAccount(mine.SeedID, "", testPassword)
	if err != nil || mineNext.SeedIndex != 1 || mineNext.SeedID != mine.SeedID {
		t.Fatalf("DeriveAccount(mine) = %+v, %v", mineNext, err)
	}
	shown, err := w.RevealSeed(hidden.SeedID, testPassword)
	if err != nil || shown.Passphrase != "hidden" || strings.Join(shown.Words, " ") != devPhrase {
		t.Fatalf("RevealSeed(hidden) = %+v, %v", shown, err)
	}

	// Removing a phrase takes its accounts, and only its own
	if err := w.RemoveSeed(dev.SeedID, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("RemoveSeed(wrong) = %v", err)
	}
	if err := w.RemoveSeed(dev.SeedID, testPassword); err != nil {
		t.Fatal(err)
	}
	info = w.Info()
	if len(info.Seeds) != 2 {
		t.Fatalf("Info.Seeds after RemoveSeed = %+v", info.Seeds)
	}
	for _, a := range info.Accounts {
		if a.Address == devAccounts[0] || a.Address == devAccounts[1] {
			t.Fatalf("%s outlived its phrase", a.Address)
		}
	}
	if len(info.Accounts) != 3 { // mine ×2, hidden ×1
		t.Fatalf("wallet has %d accounts, want 3", len(info.Accounts))
	}
	// The removed phrase can come back
	if _, err := w.ImportSeed("", devPhrase, "", testPassword, nil); err != nil {
		t.Fatalf("re-importing a removed phrase: %v", err)
	}
}

func TestDeriveSkipsAccountsAlreadyImported(t *testing.T) {
	w, _ := newTestWallet(t)
	// Account 1 of the phrase is already in the wallet, imported on its own
	entropy, _ := entropyFromWords(devPhrase)
	second, _ := schemePath(SchemeStandard, 1)
	priv, _ := deriveKey(entropy, "", second)
	if _, err := w.ImportPrivateKey("", hex.EncodeToString(crypto.FromECDSA(priv)), testPassword); err != nil {
		t.Fatal(err)
	}
	dev, err := w.ImportSeed("", devPhrase, "", testPassword, nil)
	if err != nil {
		t.Fatal(err)
	}
	next, err := w.DeriveAccount(dev.SeedID, "", testPassword)
	if err != nil || next.Address != devAccounts[2] || next.SeedIndex != 2 {
		t.Fatalf("DeriveAccount = %+v, %v; want account 2, past the imported one", next, err)
	}
}

func TestSchemePaths(t *testing.T) {
	cases := []struct {
		scheme string
		index  uint32
		want   string
	}{
		{SchemeStandard, 0, "m/44'/60'/0'/0/0"},
		{SchemeStandard, 7, "m/44'/60'/0'/0/7"},
		{SchemeLedgerLive, 0, "m/44'/60'/0'/0/0"},
		{SchemeLedgerLive, 3, "m/44'/60'/3'/0/0"},
		{SchemeLegacy, 0, "m/44'/60'/0'/0"},
		{SchemeLegacy, 2, "m/44'/60'/0'/2"},
	}
	for _, c := range cases {
		p, err := schemePath(c.scheme, c.index)
		if err != nil || p.String() != c.want {
			t.Errorf("schemePath(%s, %d) = %v, %v; want %s", c.scheme, c.index, p, err, c.want)
		}
	}
	if _, err := schemePath("bogus", 0); err == nil {
		t.Error("an unknown scheme was accepted")
	}
	if _, err := schemePath(SchemeStandard, maxSeedIndex+1); err == nil {
		t.Error("an index past the limit was accepted")
	}
}

func TestScanSeed(t *testing.T) {
	w, _ := newTestWallet(t)
	w.node = &NodeController{cfg: &ConfigStore{cfg: defaultGUIConfig()}} // stopped: addresses only

	std, err := w.ScanSeed(devPhrase, "", SchemeStandard, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range std {
		if c.Address != devAccounts[i] || c.Index != uint32(i) || c.BalanceWei != "" || c.InWallet {
			t.Errorf("standard candidate %d = %+v", i, c)
		}
	}
	// Ledger Live's first account is the standard first account
	live, err := w.ScanSeed(devPhrase, "", SchemeLedgerLive, 0, 2)
	if err != nil || live[0].Address != devAccounts[0] || live[1].Address == devAccounts[1] {
		t.Fatalf("ledger live scan = %+v, %v", live, err)
	}
	legacy, err := w.ScanSeed(devPhrase, "", SchemeLegacy, 0, 1)
	if err != nil || legacy[0].Address == devAccounts[0] || legacy[0].Path != "m/44'/60'/0'/0" {
		t.Fatalf("legacy scan = %+v, %v", legacy, err)
	}
	// A passphrase scans another wallet
	hidden, err := w.ScanSeed(devPhrase, "hidden", SchemeStandard, 0, 1)
	if err != nil || hidden[0].Address == devAccounts[0] {
		t.Fatalf("scan with a passphrase = %+v, %v", hidden, err)
	}
	for _, bad := range [][2]uint32{{0, 0}, {0, maxScan + 1}} {
		if _, err := w.ScanSeed(devPhrase, "", SchemeStandard, bad[0], bad[1]); err == nil {
			t.Errorf("ScanSeed(%v) accepted", bad)
		}
	}
	if _, err := w.ScanSeed("nope", "", SchemeStandard, 0, 1); !errors.Is(err, ErrBadMnemonic) {
		t.Fatalf("ScanSeed(bad words) = %v", err)
	}
	if len(w.Info().Seeds) != 0 || len(w.Info().Accounts) != 0 {
		t.Fatal("a scan changed the wallet")
	}

	// Picks across schemes all come in; the standard index carries on after them
	acc, err := w.ImportSeed("Main", devPhrase, "", testPassword, []SeedPick{
		{Scheme: SchemeStandard, Index: 0, Name: "Account 1"},
		{Scheme: SchemeStandard, Index: 2, Name: "Account 2"},
		{Scheme: SchemeLedgerLive, Index: 1},
		{Scheme: SchemeLegacy, Index: 0},
	})
	// The name given wins over the first pick's; the others take their picks'
	if err != nil || acc.Address != devAccounts[0] || acc.Name != "Main" {
		t.Fatalf("ImportSeed(picks) = %+v, %v", acc, err)
	}
	info := w.Info()
	if len(info.Accounts) != 4 {
		t.Fatalf("wallet has %d accounts, want 4", len(info.Accounts))
	}
	paths := map[string]bool{}
	for _, a := range info.Accounts {
		if !a.FromSeed || !a.BackedUp || a.SeedID != acc.SeedID {
			t.Errorf("%+v isn't a backed-up account of the phrase", a)
		}
		paths[a.SeedPath] = true
		if a.SeedPath == "m/44'/60'/0'/0/2" && a.Name != "Account 2" {
			t.Errorf("the second pick is named %q, want its pick's", a.Name)
		}
	}
	for _, want := range []string{"m/44'/60'/0'/0/0", "m/44'/60'/0'/0/2", "m/44'/60'/1'/0/0", "m/44'/60'/0'/0"} {
		if !paths[want] {
			t.Errorf("no account at %s", want)
		}
	}
	next, err := w.DeriveAccount(acc.SeedID, "", testPassword)
	if err != nil || next.SeedPath != "m/44'/60'/0'/0/3" {
		t.Fatalf("DeriveAccount after picks = %+v, %v; want m/44'/60'/0'/0/3", next, err)
	}
	again, _ := w.ScanSeed(devPhrase, "", SchemeStandard, 0, 1)
	if !again[0].InWallet {
		t.Fatal("a scan doesn't mark the accounts already in the wallet")
	}
}

func TestFindWalletSeedAccounts(t *testing.T) {
	w, _ := newTestWallet(t)
	w.node = &NodeController{cfg: &ConfigStore{cfg: defaultGUIConfig()}} // stopped: addresses only

	acc, err := w.ImportSeed("Main", devPhrase, "", testPassword, nil)
	if err != nil {
		t.Fatal(err)
	}
	// The phrase the wallet holds scans as its words do, without them
	found, err := w.ScanWalletSeed(acc.SeedID, testPassword, SchemeStandard, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range found {
		if c.Address != devAccounts[i] || c.InWallet != (i == 0) {
			t.Errorf("candidate %d = %+v", i, c)
		}
	}
	if _, err := w.ScanWalletSeed(acc.SeedID, "wrong password", SchemeStandard, 0, 1); err == nil {
		t.Fatal("a scan opened the phrase with the wrong password")
	}
	if _, err := w.ScanWalletSeed("nope", testPassword, SchemeStandard, 0, 1); !errors.Is(err, ErrUnknownSeed) {
		t.Fatalf("ScanWalletSeed(unknown) = %v", err)
	}

	// Picks come in as the phrase's, those already in the wallet skipped
	added, err := w.AddSeedAccounts(acc.SeedID, testPassword, []SeedPick{
		{Scheme: SchemeStandard, Index: 0, Name: "Taken"},
		{Scheme: SchemeStandard, Index: 2, Name: "Account 2"},
		{Scheme: SchemeLedgerLive, Index: 1, Name: "Account 3"},
	})
	if err != nil || added.Address != devAccounts[2] || added.SeedID != acc.SeedID || added.Name != "Account 2" {
		t.Fatalf("AddSeedAccounts = %+v, %v", added, err)
	}
	info := w.Info()
	// The account selected before stays so
	if len(info.Accounts) != 3 || info.Selected != devAccounts[0] {
		t.Fatalf("wallet has %d accounts, %s selected", len(info.Accounts), info.Selected)
	}
	names := map[string]bool{}
	for _, a := range info.Accounts {
		if a.SeedID != acc.SeedID || !a.BackedUp {
			t.Errorf("%+v isn't a backed-up account of the phrase", a)
		}
		names[a.Name] = true
	}
	// Each takes its pick's name; the one skipped keeps its own
	if !names["Main"] || !names["Account 2"] || !names["Account 3"] || names["Taken"] {
		t.Errorf("names after AddSeedAccounts = %v", names)
	}
	if _, err := w.AddSeedAccounts(acc.SeedID, testPassword, []SeedPick{{Scheme: SchemeStandard, Index: 0}}); !errors.Is(err, ErrAccountsInWallet) {
		t.Fatalf("adding what's there = %v, want ErrAccountsInWallet", err)
	}
	// The standard index carries on after the picks
	next, err := w.DeriveAccount(acc.SeedID, "", testPassword)
	if err != nil || next.SeedPath != "m/44'/60'/0'/0/3" {
		t.Fatalf("DeriveAccount after picks = %+v, %v; want m/44'/60'/0'/0/3", next, err)
	}
}

func TestCreateSeedWords(t *testing.T) {
	w, _ := newTestWallet(t)
	words, err := w.NewSeedWords(12)
	if err != nil || len(words) != 12 {
		t.Fatalf("NewSeedWords(12) = %v, %v", words, err)
	}
	if long, err := w.NewSeedWords(24); err != nil || len(long) != 24 {
		t.Fatalf("NewSeedWords(24) = %v, %v", long, err)
	} else if _, err := entropyFromWords(strings.Join(long, " ")); err != nil {
		t.Fatalf("24 words don't read back: %v", err)
	}
	if _, err := w.NewSeedWords(18); err == nil {
		t.Fatal("NewSeedWords(18) accepted")
	}
	if len(w.Info().Seeds) != 0 {
		t.Fatal("making the words stored something")
	}
	phrase := strings.Join(words, " ")
	if _, err := w.CreateSeedWords("Main", phrase, "", "wrong password", true); err == nil {
		t.Fatal("stored under the wrong password")
	}
	acc, err := w.CreateSeedWords("Main", phrase, "hidden", testPassword, false)
	if err != nil || acc.Name != "Main" || !acc.FromSeed || acc.BackedUp {
		t.Fatalf("CreateSeedWords = %+v, %v", acc, err)
	}
	if got := addrAt(t, phrase, "hidden", SchemeStandard, 0); acc.Address != got {
		t.Fatalf("first account %s, want the passphrase's %s", acc.Address, got)
	}
	info := w.Info()
	if len(info.Seeds) != 1 || info.Seeds[0].Confirmed || !info.Seeds[0].HasPassphrase || info.Selected != acc.Address {
		t.Fatalf("seeds after CreateSeedWords = %+v, selected %s", info.Seeds, info.Selected)
	}
	if _, err := w.CreateSeedWords("", phrase, "hidden", testPassword, true); !errors.Is(err, ErrSeedExists) {
		t.Fatalf("same words again = %v, want ErrSeedExists", err)
	}
	// Confirmed, the phrase backs its accounts up
	other, _ := w.NewSeedWords(24)
	acc2, err := w.CreateSeedWords("", strings.Join(other, " "), "", testPassword, true)
	if err != nil || !acc2.BackedUp {
		t.Fatalf("confirmed CreateSeedWords = %+v, %v", acc2, err)
	}
}
