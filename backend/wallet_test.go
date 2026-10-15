package backend

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

const testPassword = "correct horse battery"

// newBareWallet opens an empty wallet with light scrypt, its password not
// yet set.
func newBareWallet(t *testing.T) (*Wallet, string) {
	t.Helper()
	n, p := walletScryptN, walletScryptP
	walletScryptN, walletScryptP = keystore.LightScryptN, keystore.LightScryptP
	t.Cleanup(func() { walletScryptN, walletScryptP = n, p })
	dir := t.TempDir()
	w, err := NewWallet(dir, nil)
	if err != nil {
		t.Fatalf("NewWallet: %v", err)
	}
	return w, dir
}

// newTestWallet opens an empty wallet whose password is testPassword.
func newTestWallet(t *testing.T) (*Wallet, string) {
	t.Helper()
	w, dir := newBareWallet(t)
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatalf("SetupPassword: %v", err)
	}
	return w, dir
}

// waitForAccounts waits for the wallet's keystore to see n keys: it rescans
// its folder every few seconds, and a test may drop a key in from outside.
func waitForAccounts(t *testing.T, w *Wallet, n int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for len(w.keys().Accounts()) != n {
		if time.Now().After(deadline) {
			t.Fatalf("the keystore never saw %d keys", n)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestWalletCreateKeepsKeyEncryptedAndPrivate(t *testing.T) {
	w, dir := newTestWallet(t)
	acc, err := w.Create("Savings", testPassword)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	info := w.Info()
	if len(info.Accounts) != 1 || info.Accounts[0] != acc || info.Selected != acc.Address || acc.BackedUp || !info.HasPassword {
		t.Fatalf("Info = %+v, want the one account, selected", info)
	}
	if acc.Address != util.HexToAddress(acc.Address).Hex() {
		t.Errorf("address %s is not checksummed", acc.Address)
	}

	entries, err := os.ReadDir(filepath.Join(dir, "keystore"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("keystore holds %v (%v), want one key file", entries, err)
	}
	keyPath := filepath.Join(dir, "keystore", entries[0].Name())
	assertPrivate(t, keyPath, 0o600)
	assertPrivate(t, filepath.Join(dir, "keystore"), 0o700)
	assertPrivate(t, filepath.Join(dir, sealedMeta), 0o600)
	assertPrivate(t, filepath.Join(dir, "vault.json"), 0o600)
	// The labels are sealed: neither the name nor the address in the clear
	labels, _ := os.ReadFile(filepath.Join(dir, sealedMeta))
	if strings.Contains(string(labels), "Savings") || strings.Contains(strings.ToLower(string(labels)), strings.ToLower(acc.Address[2:])) {
		t.Fatal("the labels are kept in the clear")
	}
	if _, err := os.Stat(filepath.Join(dir, "wallet.json")); !os.IsNotExist(err) {
		t.Fatalf("a clear wallet.json is there: %v", err)
	}

	// The file is a standard encrypted keystore file that opens with the
	// wallet password and no other
	data, _ := os.ReadFile(keyPath)
	if _, err := keystore.DecryptKey(data, "wrong password"); err == nil {
		t.Fatal("key file opens with the wrong password")
	}
	key, err := keystore.DecryptKey(data, testPassword)
	if err != nil {
		t.Fatalf("key file does not open with its password: %v", err)
	}
	if key.Address.Hex() != acc.Address {
		t.Fatalf("key file holds %s, want %s", key.Address.Hex(), acc.Address)
	}
	// Neither the labels nor the vault hold the password or a key in clear
	for _, f := range []string{"wallet.json", "vault.json"} {
		raw, _ := os.ReadFile(filepath.Join(dir, f))
		if strings.Contains(string(raw), hex.EncodeToString(crypto.FromECDSA(key.PrivateKey))) || strings.Contains(string(raw), testPassword) {
			t.Fatalf("%s holds key material or the password", f)
		}
	}
}

func assertPrivate(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := fi.Mode().Perm(); got&^want != 0 {
		t.Errorf("%s has mode %o, want at most %o", path, got, want)
	}
}

func TestWalletPasswordComesFirst(t *testing.T) {
	w, _ := newBareWallet(t)
	if info := w.Info(); info.HasPassword || info.NeedsSetup {
		t.Fatalf("Info = %+v, want no password, no setup needed", info)
	}
	// No account before the password
	if _, err := w.Create("", testPassword); !errors.Is(err, ErrNoPassword) {
		t.Fatalf("Create before setup = %v, want ErrNoPassword", err)
	}
	for _, p := range []string{"", "short", "1234567"} {
		if err := w.SetupPassword(p); !errors.Is(err, ErrWeakPassword) {
			t.Errorf("SetupPassword(%q) = %v, want ErrWeakPassword", p, err)
		}
	}
	if err := w.SetupPassword(strings.Repeat("x", maxPasswordLen+1)); !errors.Is(err, ErrLongPassword) {
		t.Errorf("SetupPassword(long) = %v, want ErrLongPassword", err)
	}
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	if err := w.SetupPassword(testPassword); err == nil {
		t.Fatal("the password was set twice")
	}
	// A mistyped password never encrypts anything
	if _, err := w.Create("", "correct horse batterY"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Create(mistyped) = %v, want ErrWrongPassword", err)
	}
	if len(w.Info().Accounts) != 0 {
		t.Fatal("a mistyped password made an account")
	}
}

func TestWalletSetupOverExistingKeys(t *testing.T) {
	w, dir := newBareWallet(t)
	// Keys left by an earlier build, under one password
	ks := keystore.NewKeyStore(filepath.Join(dir, "keystore"), keystore.LightScryptN, keystore.LightScryptP)
	if _, err := ks.NewAccount(testPassword); err != nil {
		t.Fatal(err)
	}
	waitForAccounts(t, w, 1)
	if !w.Info().NeedsSetup {
		t.Fatal("a wallet with keys and no password doesn't ask for setup")
	}
	if _, err := w.Create("", testPassword); !errors.Is(err, ErrNeedsSetup) {
		t.Fatalf("Create = %v, want ErrNeedsSetup", err)
	}
	if err := w.SetupPassword("another long password"); !errors.Is(err, ErrSetupMismatch) {
		t.Fatalf("SetupPassword(not the keys') = %v, want ErrSetupMismatch", err)
	}
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatalf("SetupPassword(the keys') = %v", err)
	}
	if info := w.Info(); !info.HasPassword || info.NeedsSetup {
		t.Fatalf("Info after setup = %+v", info)
	}
}

func TestWalletImportPrivateKey(t *testing.T) {
	w, _ := newTestWallet(t)
	priv, _ := crypto.GenerateKey()
	want := crypto.PubkeyToAddress(priv.PublicKey)
	keyHex := hex.EncodeToString(crypto.FromECDSA(priv))

	for _, bad := range []string{"", "0x1234", strings.Repeat("zz", 32), strings.Repeat("00", 32), strings.Repeat("ff", 32)} {
		if _, err := w.ImportPrivateKey("", bad, testPassword); !errors.Is(err, ErrBadPrivateKey) {
			t.Errorf("ImportPrivateKey(%q) = %v, want ErrBadPrivateKey", bad, err)
		}
	}
	if _, err := w.ImportPrivateKey("", keyHex, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("ImportPrivateKey(wrong wallet password) = %v", err)
	}
	acc, err := w.ImportPrivateKey("Imported", "  0x"+keyHex+"\n", testPassword)
	if err != nil {
		t.Fatalf("ImportPrivateKey: %v", err)
	}
	if acc.Address != want.Hex() || !acc.BackedUp {
		t.Fatalf("imported %+v, want %s, backed up", acc, want.Hex())
	}
	if _, err := w.ImportPrivateKey("", keyHex, testPassword); !errors.Is(err, ErrAccountExists) {
		t.Fatalf("second import = %v, want ErrAccountExists", err)
	}
}

func TestWalletImportKeyfile(t *testing.T) {
	w, _ := newTestWallet(t)
	priv, _ := crypto.GenerateKey()
	addr := crypto.PubkeyToAddress(priv.PublicKey)
	ks := keystore.NewKeyStore(t.TempDir(), keystore.LightScryptN, keystore.LightScryptP)
	src, err := ks.ImportECDSA(priv, "weak")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(src.URL.Path)

	if _, err := w.ImportKeyfile("", "{not json", "weak", testPassword); !errors.Is(err, ErrBadKeyfile) {
		t.Errorf("garbage = %v, want ErrBadKeyfile", err)
	}
	if _, err := w.ImportKeyfile("", `{"address":"00"}`, "weak", testPassword); !errors.Is(err, ErrBadKeyfile) {
		t.Errorf("non-key JSON = %v, want ErrBadKeyfile", err)
	}
	if _, err := w.ImportKeyfile("", string(data), "nope", testPassword); !errors.Is(err, ErrWrongFilePassword) {
		t.Errorf("wrong file password = %v, want ErrWrongFilePassword", err)
	}
	if _, err := w.ImportKeyfile("", string(data), "weak", "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("wrong wallet password = %v, want ErrWrongPassword", err)
	}
	// Re-encrypted under the wallet password, whatever the file had
	acc, err := w.ImportKeyfile("", string(data), "weak", testPassword)
	if err != nil {
		t.Fatalf("ImportKeyfile: %v", err)
	}
	if acc.Address != addr.Hex() {
		t.Fatalf("imported %s, want %s", acc.Address, addr.Hex())
	}
	b, err := w.Backup(acc.Address, testPassword)
	if err != nil {
		t.Fatalf("Backup with the wallet password: %v", err)
	}
	if _, err := keystore.DecryptKey([]byte(b.Keyfile), "weak"); err == nil {
		t.Fatal("the imported key still opens with the file's password")
	}
}

func TestWalletBackupRemove(t *testing.T) {
	w, _ := newTestWallet(t)
	acc, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Backup(acc.Address, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Backup(wrong) = %v, want ErrWrongPassword", err)
	}
	b, err := w.Backup(acc.Address, testPassword)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if !json.Valid([]byte(b.Keyfile)) || !strings.HasPrefix(b.FileName, "UTC--") {
		t.Fatalf("Backup = %+v, want the keystore file", b)
	}
	if err := w.MarkBackedUp(acc.Address); err != nil || !w.Info().Accounts[0].BackedUp {
		t.Fatalf("MarkBackedUp: %v, %+v", err, w.Info())
	}
	if err := w.Rename(acc.Address, "Daily"); err != nil {
		t.Fatal(err)
	}
	if err := w.Rename(acc.Address, "bad\x00name"); err == nil {
		t.Fatal("Rename accepted a control character")
	}
	if err := w.Remove(acc.Address, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Remove(wrong) = %v, want ErrWrongPassword", err)
	}
	if err := w.Remove(acc.Address, testPassword); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if info := w.Info(); len(info.Accounts) != 0 || info.Selected != "" {
		t.Fatalf("Info after Remove = %+v", info)
	}
	if _, err := w.Backup(acc.Address, testPassword); !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("Backup after Remove = %v, want ErrUnknownAccount", err)
	}
}

func TestWalletChangePasswordReencryptsEverything(t *testing.T) {
	w, dir := newTestWallet(t)
	single, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	phrase, err := w.CreateSeed("", testPassword, "a passphrase")
	if err != nil {
		t.Fatal(err)
	}
	const next = "another long password"
	if err := w.ChangePassword("wrong password", next); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("ChangePassword(wrong) = %v", err)
	}
	if err := w.ChangePassword(testPassword, "short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("ChangePassword(weak) = %v", err)
	}
	if err := w.ChangePassword(testPassword, next); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	// Every key and the phrase open with the new password only
	if _, err := w.Backup(single.Address, testPassword); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("the key still opens with the old password: %v", err)
	}
	if _, err := w.Backup(single.Address, next); err != nil {
		t.Errorf("the key doesn't open with the new password: %v", err)
	}
	// The phrase's account signs with what opens the phrase
	if _, err := w.SignMessage(phrase.Account.Address, "hello", testPassword); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("the phrase's account still signs with the old password: %v", err)
	}
	if _, err := w.SignMessage(phrase.Account.Address, "hello", next); err != nil {
		t.Errorf("the phrase's account doesn't sign with the new password: %v", err)
	}
	got, err := w.RevealSeed(phrase.SeedID, next)
	if err != nil || strings.Join(got.Words, " ") != strings.Join(phrase.Words, " ") || got.Passphrase != "a passphrase" {
		t.Fatalf("RevealSeed after the change = %+v, %v", got, err)
	}
	// No staged file is left behind
	entries, _ := os.ReadDir(filepath.Join(dir, "keystore"))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			t.Errorf("left behind %s", e.Name())
		}
	}
}

func TestWalletChangePasswordAllOrNothing(t *testing.T) {
	w, dir := newTestWallet(t)
	acc, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	// A key dropped into the keystore under another password
	ks := keystore.NewKeyStore(filepath.Join(dir, "keystore"), keystore.LightScryptN, keystore.LightScryptP)
	if _, err := ks.NewAccount("someone else's password"); err != nil {
		t.Fatal(err)
	}
	waitForAccounts(t, w, 2)
	if err := w.ChangePassword(testPassword, "another long password"); !errors.Is(err, ErrKeyMismatch) {
		t.Fatalf("ChangePassword with a foreign key = %v, want ErrKeyMismatch", err)
	}
	// Nothing changed
	if _, err := w.Backup(acc.Address, testPassword); err != nil {
		t.Fatalf("the wallet's key no longer opens with its password: %v", err)
	}
	if _, err := w.Create("", testPassword); err != nil {
		t.Fatalf("the wallet password no longer works: %v", err)
	}
}

func TestWalletSignIsBoundToChainAndAccount(t *testing.T) {
	w, _ := newTestWallet(t)
	acc, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	ka, err := w.find(acc.Address)
	if err != nil {
		t.Fatal(err)
	}
	chainID := big.NewInt(2110)
	to := util.HexToAddress("0x00000000000000000000000000000000000000aa")
	tx := types.NewTransaction(7, to, big.NewInt(1), 21000, big.NewInt(1e9), nil)

	if _, err := w.sign(ka, "wrong password", tx, chainID); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("sign(wrong) = %v, want ErrWrongPassword", err)
	}
	signed, err := w.sign(ka, testPassword, tx, chainID)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !signed.Protected() || signed.ChainId().Cmp(chainID) != 0 {
		t.Fatalf("signature is not EIP-155 bound to %v", chainID)
	}
	from, err := types.Sender(types.LatestSignerForChainID(chainID), signed)
	if err != nil || from.Hex() != acc.Address {
		t.Fatalf("signed by %s (%v), want %s", from.Hex(), err, acc.Address)
	}
	if signed.Nonce() != 7 || *signed.To() != to || signed.Value().Int64() != 1 {
		t.Fatal("the signed transaction differs from the one asked for")
	}
}

func TestParseRecipient(t *testing.T) {
	good := "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" // EIP-55's own example
	cases := []struct {
		in   string
		want error
	}{
		{good, nil},
		{strings.ToLower(good), nil},
		{"0x" + strings.ToUpper(good[2:]), nil},
		{"  " + good + " ", nil},
		{"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", ErrBadChecksum},
		{good[2:], ErrBadRecipient}, // no 0x: likely truncated or mistyped
		{"0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe", ErrBadRecipient},
		{"0x0000000000000000000000000000000000000000", ErrBadRecipient},
		{"", ErrBadRecipient},
	}
	for _, c := range cases {
		_, err := parseRecipient(c.in)
		if !errors.Is(err, c.want) {
			t.Errorf("parseRecipient(%q) = %v, want %v", c.in, err, c.want)
		}
	}
}

func TestParseWei(t *testing.T) {
	for _, bad := range []string{"", "-1", "1.5", "0x10", "1e18", " ", strings.Repeat("9", 79)} {
		if _, err := parseWei(bad, ErrBadAmount); !errors.Is(err, ErrBadAmount) {
			t.Errorf("parseWei(%q) = %v, want ErrBadAmount", bad, err)
		}
	}
	v, err := parseWei("1000000000000000000", ErrBadAmount)
	if err != nil || v.String() != "1000000000000000000" {
		t.Fatalf("parseWei(1e18) = %v, %v", v, err)
	}
}

func TestPoolActivity(t *testing.T) {
	me := util.HexToAddress("0x1000000000000000000000000000000000000001")
	other := util.HexToAddress("0x2000000000000000000000000000000000000002")
	third := util.HexToAddress("0x3000000000000000000000000000000000000003")
	out := types.NewTransaction(0, other, big.NewInt(5), 21000, big.NewInt(1), nil)
	in := types.NewTransaction(3, me, big.NewInt(9), 21000, big.NewInt(1), nil)
	unrelated := types.NewTransaction(1, third, big.NewInt(1), 21000, big.NewInt(1), nil)
	pending := map[util.Address]types.Transactions{me: {out}, other: {in}}
	queued := map[util.Address]types.Transactions{other: {unrelated}}

	got := poolActivity(pending, queued, me)
	if len(got) != 2 {
		t.Fatalf("poolActivity = %d transactions, want 2: %+v", len(got), got)
	}
	for _, v := range got {
		if v.Hash == unrelated.Hash().Hex() {
			t.Fatal("listed a transaction neither from nor to the account")
		}
	}
}
