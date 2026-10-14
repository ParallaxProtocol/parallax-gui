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

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

const testPassword = "correct horse battery"

func newTestWallet(t *testing.T) (*Wallet, string) {
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

func TestWalletCreateKeepsKeyEncryptedAndPrivate(t *testing.T) {
	w, dir := newTestWallet(t)
	acc, err := w.Create("Savings", testPassword)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	info := w.Info()
	if len(info.Accounts) != 1 || info.Accounts[0] != acc || info.Selected != acc.Address || acc.BackedUp {
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
	assertPrivate(t, filepath.Join(dir, "wallet.json"), 0o600)

	// The file is a standard encrypted keystore file that opens with the
	// password and no other
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
	// The labels file holds nothing secret
	meta, _ := os.ReadFile(filepath.Join(dir, "wallet.json"))
	if strings.Contains(string(meta), hex.EncodeToString(crypto.FromECDSA(key.PrivateKey))) || strings.Contains(string(meta), testPassword) {
		t.Fatal("wallet.json holds key material or the password")
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

func TestWalletRejectsWeakPasswords(t *testing.T) {
	w, _ := newTestWallet(t)
	for _, p := range []string{"", "short", "1234567"} {
		if _, err := w.Create("", p); !errors.Is(err, ErrWeakPassword) {
			t.Errorf("Create(%q) = %v, want ErrWeakPassword", p, err)
		}
	}
	if _, err := w.Create("", strings.Repeat("x", maxPasswordLen+1)); !errors.Is(err, ErrLongPassword) {
		t.Errorf("Create(long) = %v, want ErrLongPassword", err)
	}
	if len(w.Info().Accounts) != 0 {
		t.Fatal("a refused password still made an account")
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
	src, err := ks.ImportECDSA(priv, "file password")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(src.URL.Path)

	if _, err := w.ImportKeyfile("", "{not json", "file password", ""); !errors.Is(err, ErrBadKeyfile) {
		t.Errorf("garbage = %v, want ErrBadKeyfile", err)
	}
	if _, err := w.ImportKeyfile("", `{"address":"00"}`, "file password", ""); !errors.Is(err, ErrBadKeyfile) {
		t.Errorf("non-key JSON = %v, want ErrBadKeyfile", err)
	}
	if _, err := w.ImportKeyfile("", string(data), "nope nope nope", ""); !errors.Is(err, ErrWrongPassword) {
		t.Errorf("wrong file password = %v, want ErrWrongPassword", err)
	}
	// Re-encrypted under the new password
	acc, err := w.ImportKeyfile("", string(data), "file password", testPassword)
	if err != nil {
		t.Fatalf("ImportKeyfile: %v", err)
	}
	if acc.Address != addr.Hex() {
		t.Fatalf("imported %s, want %s", acc.Address, addr.Hex())
	}
	b, err := w.Backup(acc.Address, testPassword)
	if err != nil {
		t.Fatalf("Backup with the new password: %v", err)
	}
	if _, err := keystore.DecryptKey([]byte(b.Keyfile), "file password"); err == nil {
		t.Fatal("the imported key still opens with the file's password")
	}

	// A file whose own password is too weak to keep must get a new one
	priv2, _ := crypto.GenerateKey()
	src2, _ := ks.ImportECDSA(priv2, "weak")
	data2, _ := os.ReadFile(src2.URL.Path)
	if _, err := w.ImportKeyfile("", string(data2), "weak", ""); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("weak file password kept = %v, want ErrWeakPassword", err)
	}
}

func TestWalletBackupChangePasswordRemove(t *testing.T) {
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

	const next = "another long password"
	if err := w.ChangePassword(acc.Address, "wrong password", next); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("ChangePassword(wrong) = %v", err)
	}
	if err := w.ChangePassword(acc.Address, testPassword, "short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("ChangePassword(weak) = %v", err)
	}
	if err := w.ChangePassword(acc.Address, testPassword, next); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if _, err := w.Backup(acc.Address, testPassword); !errors.Is(err, ErrWrongPassword) {
		t.Fatal("the old password still opens the key")
	}

	if err := w.Rename(acc.Address, "Daily"); err != nil {
		t.Fatal(err)
	}
	if err := w.Rename(acc.Address, "bad\x00name"); err == nil {
		t.Fatal("Rename accepted a control character")
	}
	if err := w.Remove(acc.Address, testPassword); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Remove(old password) = %v, want ErrWrongPassword", err)
	}
	if err := w.Remove(acc.Address, next); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if info := w.Info(); len(info.Accounts) != 0 || info.Selected != "" {
		t.Fatalf("Info after Remove = %+v", info)
	}
	if _, err := w.Backup(acc.Address, next); !errors.Is(err, ErrUnknownAccount) {
		t.Fatalf("Backup after Remove = %v, want ErrUnknownAccount", err)
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
