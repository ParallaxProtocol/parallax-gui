// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/ecdsa"
	"errors"
	"math/big"
	"sync"
	"testing"
	"time"

	parallax "github.com/ParallaxProtocol/parallax/v2"
	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/usbwallet"
)

// fakeDevice is a Ledger the tests plug in: a key for every path, derived
// from its seed, and the states a real one can be in.
type fakeDevice struct {
	kind, path string
	seed       byte

	mu        sync.Mutex
	keys      map[string]*ecdsa.PrivateKey
	pinned    map[util.Address]wallet.DerivationPath
	locked    bool // behind its PIN
	appClosed bool // the Ethereum app isn't open
	deny      bool // the user turns signing down
	signed    int
	delay     time.Duration // how long each address takes, as a real device's exchange does
}

func newFakeDevice(seed byte) *fakeDevice {
	return &fakeDevice{kind: DeviceLedger, path: "fake-" + string('a'+seed), seed: seed,
		keys: map[string]*ecdsa.PrivateKey{}, pinned: map[util.Address]wallet.DerivationPath{}}
}

func (d *fakeDevice) key(path wallet.DerivationPath) *ecdsa.PrivateKey {
	d.mu.Lock()
	defer d.mu.Unlock()
	k := d.keys[path.String()]
	if k == nil {
		seed := crypto.Keccak256([]byte{d.seed}, []byte(path.String()))
		k, _ = crypto.ToECDSA(seed)
		d.keys[path.String()] = k
	}
	return k
}

func (d *fakeDevice) address(path wallet.DerivationPath) util.Address {
	return crypto.PubkeyToAddress(d.key(path).PublicKey)
}

func (d *fakeDevice) refuse() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	switch {
	case d.locked:
		return usbwallet.ErrLedgerLocked
	case d.appClosed:
		return usbwallet.ErrLedgerAppClosed
	}
	return nil
}

func (d *fakeDevice) URL() wallet.URL            { return wallet.URL{Scheme: d.kind, Path: d.path} }
func (d *fakeDevice) Status() (string, error)    { return "online", nil }
func (d *fakeDevice) Open(string) error          { return nil }
func (d *fakeDevice) Close() error               { return nil }
func (d *fakeDevice) Accounts() []wallet.Account { return nil }
func (d *fakeDevice) Contains(acc wallet.Account) bool {
	_, ok := d.pinned[acc.Address]
	return ok
}
func (d *fakeDevice) Derive(path wallet.DerivationPath, pin bool) (wallet.Account, error) {
	time.Sleep(d.delay)
	if err := d.refuse(); err != nil {
		return wallet.Account{}, err
	}
	addr := d.address(path)
	if pin {
		d.mu.Lock()
		d.pinned[addr] = path
		d.mu.Unlock()
	}
	return wallet.Account{Address: addr, URL: d.URL()}, nil
}
func (d *fakeDevice) SelfDerive([]wallet.DerivationPath, parallax.ChainStateReader) {}
func (d *fakeDevice) SignData(wallet.Account, string, []byte) ([]byte, error) {
	return nil, wallet.ErrNotSupported
}
func (d *fakeDevice) SignDataWithPassphrase(wallet.Account, string, string, []byte) ([]byte, error) {
	return nil, wallet.ErrNotSupported
}
func (d *fakeDevice) signer(acc wallet.Account) (*ecdsa.PrivateKey, error) {
	if err := d.refuse(); err != nil {
		return nil, err
	}
	d.mu.Lock()
	path, ok := d.pinned[acc.Address]
	deny := d.deny
	d.mu.Unlock()
	if !ok {
		return nil, wallet.ErrUnknownAccount
	}
	if deny {
		return nil, usbwallet.ErrLedgerDenied
	}
	return d.key(path), nil
}
func (d *fakeDevice) SignText(acc wallet.Account, text []byte) ([]byte, error) {
	key, err := d.signer(acc)
	if err != nil {
		return nil, err
	}
	return crypto.Sign(wallet.TextHash(text), key)
}
func (d *fakeDevice) SignTextWithPassphrase(acc wallet.Account, _ string, text []byte) ([]byte, error) {
	return d.SignText(acc, text)
}
func (d *fakeDevice) SignTx(acc wallet.Account, tx *types.Transaction, chainID *big.Int) (*types.Transaction, error) {
	key, err := d.signer(acc)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.signed++
	d.mu.Unlock()
	return types.SignTx(tx, types.LatestSignerForChainID(chainID), key)
}
func (d *fakeDevice) SignTxWithPassphrase(acc wallet.Account, _ string, tx *types.Transaction, chainID *big.Int) (*types.Transaction, error) {
	return d.SignTx(acc, tx, chainID)
}

// fakeHub is the USB as the tests plug devices into it.
type fakeHub struct {
	mu   sync.Mutex
	devs []wallet.Wallet
}

func (h *fakeHub) Wallets() []wallet.Wallet {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]wallet.Wallet(nil), h.devs...)
}

func (h *fakeHub) plug(devs ...*fakeDevice) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.devs = nil
	for _, d := range devs {
		h.devs = append(h.devs, d)
	}
}

// withFakeHub has the wallets the test opens find their devices on hub.
func withFakeHub(t *testing.T) *fakeHub {
	hub := new(fakeHub)
	open := openHardwareHubs
	openHardwareHubs = func() ([]hwHub, error) { return []hwHub{hub}, nil }
	t.Cleanup(func() { openHardwareHubs = open })
	return hub
}

func deviceState(t *testing.T, w *Wallet) string {
	t.Helper()
	devs, err := w.HardwareDevices()
	if err != nil {
		t.Fatal(err)
	}
	if len(devs) != 1 {
		t.Fatalf("%d devices listed, want 1", len(devs))
	}
	return devs[0].State
}

// TestHardwareAccounts brings accounts in from a device's scan, signs with
// one there, and lets it go without a password.
func TestHardwareAccounts(t *testing.T) {
	hub := withFakeHub(t)
	w, _ := newTestWallet(t)
	dev := newFakeDevice(1)
	hub.plug(dev)

	if s := deviceState(t, w); s != hwReady {
		t.Fatalf("state %q, want %q", s, hwReady)
	}
	found, err := w.HardwareScan(dev.URL().String(), SchemeStandard, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range found {
		path, _ := schemePath(SchemeStandard, uint32(i))
		if c.Address != dev.address(path).Hex() || c.Path != path.String() || c.InWallet {
			t.Fatalf("candidate %d = %+v, want %s at %s", i, c, dev.address(path).Hex(), path)
		}
	}
	first, err := w.AddHardwareAccounts(dev.URL().String(), []SeedPick{
		{Scheme: SchemeStandard, Index: 0, Name: "Ledger 1"},
		{Scheme: SchemeLedgerLive, Index: 1, Name: "Ledger 2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Address != found[0].Address || first.Hardware != DeviceLedger || first.Name != "Ledger 1" || !first.BackedUp {
		t.Fatalf("first account %+v", first)
	}
	info := w.Info()
	if len(info.Accounts) != 2 || info.Selected != first.Address {
		t.Fatalf("Info = %+v, want the two accounts, the first selected", info)
	}
	live, _ := schemePath(SchemeLedgerLive, 1)
	if acc := info.Accounts[1]; acc.Address != dev.address(live).Hex() || acc.HardwarePath != live.String() {
		t.Fatalf("second account %+v, want %s at %s", acc, dev.address(live).Hex(), live)
	}
	// Picked again, they're in the wallet already
	if _, err := w.AddHardwareAccounts(dev.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 0}}); !errors.Is(err, ErrAccountsInWallet) {
		t.Fatalf("adding again: %v, want %v", err, ErrAccountsInWallet)
	}
	if again, _ := w.HardwareScan(dev.URL().String(), SchemeStandard, 0, 1); !again[0].InWallet {
		t.Fatal("an account in the wallet isn't marked so in a scan")
	}

	// The device signs, with no password
	msg := "Signed on a Ledger"
	signed, err := w.SignMessage(first.Address, msg, "")
	if err != nil {
		t.Fatal(err)
	}
	if check, err := VerifyMessage(first.Address, msg, signed.Signature); err != nil || !check.Valid {
		t.Fatalf("signature doesn't verify: %+v %v", check, err)
	}
	// Removing it asks for none either, and the key file path never runs
	if err := w.Remove(first.Address, ""); err != nil {
		t.Fatal(err)
	}
	if info := w.Info(); len(info.Accounts) != 1 || info.Accounts[0].Address != dev.address(live).Hex() {
		t.Fatalf("after removing: %+v", info.Accounts)
	}
}

// TestHardwareNotReady checks what a send or a signature says while the
// device can't make it, and that a device of another phrase isn't asked.
func TestHardwareNotReady(t *testing.T) {
	hub := withFakeHub(t)
	w, _ := newTestWallet(t)
	dev := newFakeDevice(1)
	hub.plug(dev)
	acc, err := w.AddHardwareAccounts(dev.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 0}})
	if err != nil {
		t.Fatal(err)
	}
	sign := func() error {
		_, err := w.SignMessage(acc.Address, "hello", "")
		return err
	}

	dev.appClosed = true
	if s := deviceState(t, w); s != hwApp {
		t.Fatalf("state %q with the app closed, want %q", s, hwApp)
	}
	if err := sign(); !errors.Is(err, ErrHardwareAppClosed) || !hardwareRetry(err) {
		t.Fatalf("app closed: %v, want %v", err, ErrHardwareAppClosed)
	}
	dev.appClosed, dev.locked = false, true
	if err := sign(); !errors.Is(err, ErrHardwareLocked) {
		t.Fatalf("locked: %v, want %v", err, ErrHardwareLocked)
	}
	dev.locked, dev.deny = false, true
	if err := sign(); !errors.Is(err, ErrHardwareDenied) || hardwareRetry(err) {
		t.Fatalf("denied: %v, want %v", err, ErrHardwareDenied)
	}
	dev.deny = false
	if err := sign(); err != nil {
		t.Fatalf("ready again: %v", err)
	}

	// Another phrase's device doesn't hold it, and isn't asked to sign
	other := newFakeDevice(2)
	hub.plug(other)
	if err := sign(); !errors.Is(err, ErrHardwareMismatch) {
		t.Fatalf("another device: %v, want %v", err, ErrHardwareMismatch)
	}
	if other.signed != 0 {
		t.Fatal("a device that doesn't hold the account was asked to sign")
	}
	// Both plugged in, the one that holds it signs
	hub.plug(other, dev)
	if err := sign(); err != nil {
		t.Fatalf("with both plugged in: %v", err)
	}
	hub.plug()
	if err := sign(); !errors.Is(err, ErrHardwareNoDevice) {
		t.Fatalf("unplugged: %v, want %v", err, ErrHardwareNoDevice)
	}
}

// TestHardwareSignTx signs a transfer on the device through the wallet's
// own checks: bound to the chain, recovering to the account.
func TestHardwareSignTx(t *testing.T) {
	hub := withFakeHub(t)
	w, _ := newTestWallet(t)
	dev := newFakeDevice(3)
	hub.plug(dev)
	added, err := w.AddHardwareAccounts(dev.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 0}})
	if err != nil {
		t.Fatal(err)
	}
	acc, err := w.find(added.Address)
	if err != nil || !isHardware(acc) {
		t.Fatalf("find: %+v %v, want the hardware account", acc, err)
	}
	chainID := big.NewInt(2110)
	tx := types.NewTransaction(0, util.HexToAddress("0x00000000000000000000000000000000000000aa"), big.NewInt(1), 21000, big.NewInt(1e9), nil)
	signed, err := w.sign(acc, "", tx, chainID)
	if err != nil {
		t.Fatal(err)
	}
	if signed.ChainId().Cmp(chainID) != 0 || dev.signed != 1 {
		t.Fatalf("signed for chain %v, %d signatures", signed.ChainId(), dev.signed)
	}
}

// TestHardwareWallets gathers accounts by the wallet their device holds,
// names each "Hardware Wallet N" as it is first seen, renames it, gives an
// account from before they were told apart its wallet once its device
// answers, and lets a wallet go with its last account.
func TestHardwareWallets(t *testing.T) {
	hub := withFakeHub(t)
	w, _ := newTestWallet(t)
	one, two := newFakeDevice(1), newFakeDevice(2)
	std0, _ := schemePath(SchemeStandard, 0)

	hub.plug(one)
	a, err := w.AddHardwareAccounts(one.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 0}, {Scheme: SchemeStandard, Index: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if a.HardwareWallet != one.address(std0).Hex() {
		t.Fatalf("account's wallet %q, want the device's first address %s", a.HardwareWallet, one.address(std0).Hex())
	}
	hub.plug(two)
	if _, err := w.AddHardwareAccounts(two.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 3}}); err != nil {
		t.Fatal(err)
	}
	info := w.Info()
	want := []HardwareWalletInfo{
		{ID: one.address(std0).Hex(), Kind: DeviceLedger, Name: "Hardware Wallet 1", Accounts: 2},
		{ID: two.address(std0).Hex(), Kind: DeviceLedger, Name: "Hardware Wallet 2", Accounts: 1},
	}
	if len(info.HardwareWallets) != 2 || info.HardwareWallets[0] != want[0] || info.HardwareWallets[1] != want[1] {
		t.Fatalf("hardware wallets %+v, want %+v", info.HardwareWallets, want)
	}
	if devs, _ := w.HardwareDevices(); len(devs) != 1 || devs[0].Wallet != want[1].ID {
		t.Fatalf("devices %+v, want the second wallet's", devs)
	}

	if err := w.RenameHardwareWallet(want[0].ID, "Cold storage"); err != nil {
		t.Fatal(err)
	}
	if err := w.RenameHardwareWallet("0x00", "x"); !errors.Is(err, ErrUnknownHardwareWallet) {
		t.Fatalf("renaming an unknown one: %v", err)
	}

	// With the first wallet's device unplugged, its accounts don't sign on
	// the second's, which holds another wallet
	if _, err := w.SignMessage(a.Address, "hi", ""); !errors.Is(err, ErrHardwareMismatch) {
		t.Fatalf("signing on another wallet's device: %v, want %v", err, ErrHardwareMismatch)
	}

	// An account from before wallets were told apart is claimed by the
	// device that holds it once it answers
	w.mu.Lock()
	for i := range w.meta.Hardware {
		if w.meta.Hardware[i].Wallet == want[1].ID {
			w.meta.Hardware[i].Wallet = ""
		}
	}
	w.mu.Unlock()
	hub.plug(newFakeDevice(2)) // plugged in again: checked afresh
	if _, err := w.HardwareDevices(); err != nil {
		t.Fatal(err)
	}
	info = w.Info()
	if info.HardwareWallets[0].Name != "Cold storage" || info.HardwareWallets[1].Accounts != 1 {
		t.Fatalf("after claiming: %+v", info.HardwareWallets)
	}

	// The second wallet goes with its last account, and the next one seen
	// takes its number again
	for _, acc := range info.Accounts {
		if acc.HardwareWallet == want[1].ID {
			if err := w.RemoveHardware(acc.Address); err != nil {
				t.Fatal(err)
			}
		}
	}
	if info := w.Info(); len(info.HardwareWallets) != 1 || info.HardwareWallets[0].ID != want[0].ID {
		t.Fatalf("after removing: %+v", info.HardwareWallets)
	}
	three := newFakeDevice(3)
	hub.plug(three)
	if _, err := w.AddHardwareAccounts(three.URL().String(), []SeedPick{{Scheme: SchemeStandard, Index: 0}}); err != nil {
		t.Fatal(err)
	}
	if hw := w.Info().HardwareWallets; len(hw) != 2 || hw[1].Name != "Hardware Wallet 2" {
		t.Fatalf("a new wallet after one went: %+v", hw)
	}
}

// TestHardwareScansWait runs scans (as the picker's tabs ask for them) side
// by side with the device list's polling: each waits for the device rather
// than failing as busy.
func TestHardwareScansWait(t *testing.T) {
	hub := withFakeHub(t)
	w, _ := newTestWallet(t)
	dev := newFakeDevice(1)
	dev.delay = 5 * time.Millisecond
	hub.plug(dev)
	if s := deviceState(t, w); s != hwReady {
		t.Fatalf("state %q", s)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for _, scheme := range []string{SchemeStandard, SchemeLedgerLive, SchemeLegacy, SchemeStandard} {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, err := w.HardwareScan(dev.URL().String(), scheme, 0, 5)
			errs <- err
		}()
		go func() {
			defer wg.Done()
			_, err := w.HardwareDevices()
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("a scan beside the polling: %v", err)
		}
	}
}
