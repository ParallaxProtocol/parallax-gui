// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/usbwallet"
)

// A hardware wallet account's key is on a Ledger or a Trezor, which signs
// once the user confirms on its own screen: the wallet keeps only the
// address, the kind of device and where along its path the account is
// (hardwareRef, sealed with the labels). The devices run their Ethereum
// apps, Parallax using Ethereum's coin type (60) and EIP-155 transactions
// for its own chain ID.
//
// No account is tied to one device: signing takes a connected device of
// the account's kind that derives the account's address at its path, so a
// replacement restored from the same recovery phrase signs as well, and a
// device that doesn't (another phrase, another Trezor passphrase) is told
// apart before it is asked to sign anything.
//
// The accounts are gathered by the wallet they are on, told apart as
// phrases are (seedMeta.Fingerprint): by the address the device derives at
// the first standard path, the same for every device holding that phrase
// (and passphrase). Each such hardware wallet has a name, as a phrase does.
// An account added before they did gets its wallet's the first time a
// device that holds it answers (claimHardware).

// Device kinds, as the daemon's USB hubs name their schemes.
const (
	DeviceLedger = usbwallet.LedgerScheme
	DeviceTrezor = usbwallet.TrezorScheme
)

// Errors the frontend recognises, by message (WALLET_ERRORS in
// frontend/src/lib/api.ts).
var (
	ErrHardwareUnsupported = errors.New("hardware: this build of the app can't reach USB devices")
	ErrHardwareNoDevice    = errors.New("hardware: connect the device that holds this account")
	ErrHardwareUnknown     = errors.New("hardware: the device is no longer connected")
	ErrHardwareMismatch    = errors.New("hardware: the device connected doesn't hold this account")
	ErrHardwareDenied      = errors.New("hardware: the request was turned down on the device")
	ErrHardwareLocked      = errors.New("hardware: unlock the device first")
	ErrHardwareAppClosed   = errors.New("hardware: open the Ethereum app on the device")
	ErrHardwareNotReady    = errors.New("hardware: the device isn't ready yet")
	ErrHardwareBusy        = errors.New("hardware: the device is busy with another request")
	ErrHardwarePIN         = errors.New("hardware: wrong PIN")
	ErrHardwareAccess      = errors.New("hardware: the app isn't allowed to open the device")
	ErrHardwareBlind       = errors.New("hardware: allow blind signing in the device's Ethereum app")
)

// Device states, as HardwareDevice tells them.
const (
	hwReady      = "ready"      // unlocked, the Ethereum app open: it can sign
	hwLocked     = "locked"     // locked behind its PIN, entered on the device
	hwApp        = "app"        // a Ledger without its Ethereum app open
	hwPIN        = "pin"        // a Trezor One waiting for its PIN, entered here on the pad it shows
	hwPassphrase = "passphrase" // a Trezor One waiting for its passphrase, typed here
	hwConfirm    = "confirm"    // waiting on the user at the device: a PIN or passphrase on its screen
	hwBusy       = "busy"       // asked to sign, or to show an address, and waiting on the user
	hwAccess     = "access"     // the system wouldn't let the app open it (on Linux, its udev rules)
	hwFailed     = "error"
)

// HardwareDevice is a connected Ledger or Trezor, as the frontend lists it.
type HardwareDevice struct {
	// ID tells the device apart for as long as it stays plugged in: its USB
	// path
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	State string `json:"state"`
	// Error is why it is in its state, when that is a failure (a wrong PIN
	// to try again, a device the app may not open)
	Error string `json:"error"`
	// SetupUSB is set when the app may not open the device on a Linux
	// without its udev rules, which HardwareSetupUSB installs
	SetupUSB bool `json:"setupUsb"`
	// Wallet is the hardware wallet the device holds (HardwareWalletInfo's
	// ID), once it has said: from when it is first ready
	Wallet string `json:"wallet"`
}

// HardwareWalletInfo is a hardware wallet the wallet has accounts of, as
// the frontend shows it: nothing secret.
type HardwareWalletInfo struct {
	// ID is the address its devices derive at the first standard path
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Accounts int    `json:"accounts"`
}

// hardwareWalletMeta is what the wallet keeps of a hardware wallet in its
// labels.
type hardwareWalletMeta struct {
	ID     string `json:"id"`
	Device string `json:"device"`
	Name   string `json:"name"`
}

// ErrUnknownHardwareWallet: no hardware wallet of that ID in the wallet.
var ErrUnknownHardwareWallet = errors.New("hardware: no such hardware wallet in this wallet")

// hardwareRef is where a hardware wallet account is: on which kind of
// device, and its derivation path there.
type hardwareRef struct {
	Address string `json:"address"`
	Device  string `json:"device"`
	Path    string `json:"path"`
	// Wallet is the hardware wallet it is on (hardwareWalletMeta.ID); empty
	// until known, for one added before wallets were told apart
	Wallet string `json:"wallet,omitempty"`
}

// hardware follows the connected devices through the daemon's USB hubs,
// started the first time a device is looked for, so the app doesn't poll
// USB for a user who has none.
type hardware struct {
	once sync.Once
	hubs []hwHub
	err  error

	mu   sync.Mutex // guards devs and every device's state
	devs map[string]*hwDevice
}

// hwDevice is one connected device.
type hwDevice struct {
	w    wallet.Wallet
	kind string

	// op admits one request on the device at a time: the USB protocol
	// is one exchange after another, and a request waiting on the user
	// holds it until they answer
	op sync.Mutex

	// The rest are guarded by hardware.mu
	open    bool   // opened, and for a Trezor unlocked
	opening bool   // an open is waiting on the user at the device
	busy    bool   // a request holds op
	state   string // the last state found
	err     error
	// wallet is the address it derives at the first standard path, its
	// hardware wallet's ID, once it has said (zero until then)
	wallet util.Address
	// claimed is set once the wallet's accounts of no known hardware
	// wallet were checked against this device (claimHardware)
	claimed bool
	// retry is when a device that couldn't be opened (the system wouldn't
	// let the app have it, or the user turned a Trezor's prompt down) is
	// tried again, so it isn't every second
	retry time.Time
}

// openRetry is how long a device that couldn't be opened is left before it
// is tried again.
const openRetry = 5 * time.Second

// hwHub is where connected devices are found: one of the daemon's USB
// hubs, or a test's.
type hwHub interface {
	Wallets() []wallet.Wallet
}

// openHardwareHubs opens the daemon's USB hubs: Ledger's, and Trezor's for
// firmware that speaks HID (the One before 1.8, the T before 2.1) and for
// the rest, which speak WebUSB. Tests replace it.
var openHardwareHubs = func() ([]hwHub, error) {
	ledger, err := usbwallet.NewLedgerHub()
	if err != nil {
		// The USB library is left out of a build without cgo
		logging.Warn("Hardware wallets unavailable", "err", err)
		return nil, ErrHardwareUnsupported
	}
	hubs := []hwHub{ledger}
	if hub, err := usbwallet.NewTrezorHubWithHID(); err == nil {
		hubs = append(hubs, hub)
	}
	if hub, err := usbwallet.NewTrezorHubWithWebUSB(); err == nil {
		hubs = append(hubs, hub)
	}
	return hubs, nil
}

// start opens the USB hubs, once.
func (h *hardware) start() error {
	h.once.Do(func() {
		h.devs = map[string]*hwDevice{}
		h.hubs, h.err = openHardwareHubs()
	})
	return h.err
}

// refresh brings the devices in step with what is plugged in, and finds
// each one's state: a Ledger is asked for an address, which says whether
// it is unlocked with its app open; a Trezor is opened, which has it ask
// for its PIN and passphrase if it needs them, in the background while it
// waits on the user at the device.
func (h *hardware) refresh() ([]*hwDevice, error) {
	if err := h.start(); err != nil {
		return nil, err
	}
	var plugged []wallet.Wallet
	for _, hub := range h.hubs {
		plugged = append(plugged, hub.Wallets()...)
	}
	h.mu.Lock()
	seen := map[string]bool{}
	var devs []*hwDevice
	for _, w := range plugged {
		id := w.URL().String()
		seen[id] = true
		d := h.devs[id]
		if d == nil || d.w != w {
			d = &hwDevice{w: w, kind: w.URL().Scheme}
			h.devs[id] = d
		}
		devs = append(devs, d)
	}
	for id := range h.devs {
		if !seen[id] {
			delete(h.devs, id)
		}
	}
	h.mu.Unlock()

	for _, d := range devs {
		h.probe(d)
	}
	return devs, nil
}

// probe finds a device's state, unless a request or an open holds it.
func (h *hardware) probe(d *hwDevice) {
	h.mu.Lock()
	if d.busy || d.opening || time.Now().Before(d.retry) {
		h.mu.Unlock()
		return
	}
	if d.kind == DeviceTrezor {
		if d.open || d.state == hwPIN || d.state == hwPassphrase {
			h.mu.Unlock()
			return
		}
		d.opening, d.state, d.err = true, hwConfirm, nil
		h.mu.Unlock()
		go h.openTrezor(d, "")
		return
	}
	h.mu.Unlock()

	if !d.op.TryLock() {
		return
	}
	defer d.op.Unlock()
	state, err := h.probeLedger(d)
	h.mu.Lock()
	d.state, d.err = state, err
	if state == hwAccess || state == hwFailed {
		d.retry = time.Now().Add(openRetry)
	}
	h.mu.Unlock()
}

// probeLedger opens a Ledger if it isn't yet, and asks it for the address
// at the standard path: what it replies says its state. The caller holds
// d.op.
func (h *hardware) probeLedger(d *hwDevice) (string, error) {
	h.mu.Lock()
	open := d.open
	h.mu.Unlock()
	if !open {
		if err := d.w.Open(""); err != nil && !errors.Is(err, wallet.ErrWalletAlreadyOpen) {
			logging.Warn("Failed to open a Ledger", "err", err)
			if openFailed(err) {
				return hwAccess, ErrHardwareAccess
			}
			return hwFailed, hardwareError(err)
		}
		h.mu.Lock()
		d.open = true
		h.mu.Unlock()
	}
	acc, err := d.w.Derive(wallet.DefaultBaseDerivationPath, false)
	if err != nil {
		herr := hardwareError(err)
		switch herr {
		case ErrHardwareLocked:
			return hwLocked, nil
		case ErrHardwareAppClosed:
			return hwApp, nil
		}
		// The device stopped answering: open it afresh next time
		h.forget(d)
		return hwFailed, herr
	}
	h.setWallet(d, acc.Address)
	return hwReady, nil
}

// setWallet records the hardware wallet a device holds, by the address at
// the first standard path: another (a Ledger restored from another phrase
// meanwhile) has its accounts checked again.
func (h *hardware) setWallet(d *hwDevice, id util.Address) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if d.wallet != id {
		d.wallet, d.claimed = id, false
	}
}

// walletOf returns the hardware wallet a device holds, asking it if it
// hasn't said yet. The caller holds d.op.
func (h *hardware) walletOf(d *hwDevice) (util.Address, error) {
	h.mu.Lock()
	id := d.wallet
	h.mu.Unlock()
	if id != (util.Address{}) {
		return id, nil
	}
	acc, err := d.w.Derive(wallet.DefaultBaseDerivationPath, false)
	if err != nil {
		return util.Address{}, err
	}
	h.setWallet(d, acc.Address)
	return acc.Address, nil
}

// openTrezor opens a Trezor with secret, its PIN or passphrase or none at
// first, and sets the state that follows. It runs while the device may wait
// on the user (a PIN or passphrase entered on its screen).
func (h *hardware) openTrezor(d *hwDevice, secret string) {
	err := d.w.Open(secret)
	if errors.Is(err, usbwallet.ErrTrezorPINInvalid) {
		// The device turned the PIN down and dropped the request: ask it
		// for the PIN again, on a pad shuffled afresh
		if err = d.w.Open(""); errors.Is(err, usbwallet.ErrTrezorPINNeeded) {
			h.setOpened(d, false, hwPIN, ErrHardwarePIN)
			return
		}
	}
	switch {
	case err == nil, errors.Is(err, wallet.ErrWalletAlreadyOpen):
		// Which wallet it holds, read before it is offered: it opened on the
		// standard path, so this asks for nothing more
		if d.op.TryLock() {
			if acc, err := d.w.Derive(wallet.DefaultBaseDerivationPath, false); err == nil {
				h.setWallet(d, acc.Address)
			}
			d.op.Unlock()
		}
		h.setOpened(d, true, hwReady, nil)
	case errors.Is(err, usbwallet.ErrTrezorPINNeeded):
		h.setOpened(d, false, hwPIN, nil)
	case errors.Is(err, usbwallet.ErrTrezorPassphraseNeeded):
		h.setOpened(d, false, hwPassphrase, nil)
	case errors.Is(err, usbwallet.ErrTrezorDenied):
		// Turned down at the device: ask again, after a while
		d.w.Close()
		h.setOpened(d, false, hwLocked, nil)
		h.retryLater(d)
	case openFailed(err):
		logging.Warn("Failed to open a Trezor", "err", err)
		d.w.Close()
		h.setOpened(d, false, hwAccess, ErrHardwareAccess)
		h.retryLater(d)
	default:
		logging.Warn("Failed to open a Trezor", "err", err)
		d.w.Close()
		h.setOpened(d, false, hwFailed, hardwareError(err))
		h.retryLater(d)
	}
}

// retryLater leaves a device that couldn't be opened for a while.
func (h *hardware) retryLater(d *hwDevice) {
	h.mu.Lock()
	d.retry = time.Now().Add(openRetry)
	h.mu.Unlock()
}

// openFailed reports whether err is the USB library failing to open or
// claim a device, as it does when the system doesn't let the app have it.
func openFailed(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "failed to open device") || strings.Contains(msg, "failed to claim interface")
}

func (h *hardware) setOpened(d *hwDevice, open bool, state string, err error) {
	h.mu.Lock()
	d.open, d.opening, d.state, d.err = open, false, state, err
	h.mu.Unlock()
}

// forget closes a device that stopped answering, or that wants its PIN
// again, for it to be opened afresh.
func (h *hardware) forget(d *hwDevice) {
	d.w.Close()
	h.mu.Lock()
	d.open, d.state = false, ""
	h.mu.Unlock()
}

// list tells the connected devices.
func (h *hardware) list() ([]HardwareDevice, error) {
	devs, err := h.refresh()
	if err != nil {
		return nil, err
	}
	out := make([]HardwareDevice, 0, len(devs))
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, d := range devs {
		state := d.state
		if d.busy {
			state = hwBusy
		}
		if state == "" {
			state = hwConfirm
		}
		dev := HardwareDevice{ID: d.w.URL().String(), Kind: d.kind, State: state, SetupUSB: state == hwAccess && usbSetupNeeded()}
		if d.err != nil {
			dev.Error = d.err.Error()
		}
		if d.wallet != (util.Address{}) {
			dev.Wallet = d.wallet.Hex()
		}
		out = append(out, dev)
	}
	return out, nil
}

// unlock gives a Trezor One waiting for its PIN or passphrase what it asked
// for. It returns at once: the device may then ask for the passphrase on
// its screen, and the state tells how it went.
func (h *hardware) unlock(id, secret string) error {
	if err := h.start(); err != nil {
		return err
	}
	h.mu.Lock()
	d := h.devs[id]
	if d == nil {
		h.mu.Unlock()
		return ErrHardwareUnknown
	}
	if d.state != hwPIN && d.state != hwPassphrase || d.opening {
		h.mu.Unlock()
		return ErrHardwareNotReady
	}
	d.opening, d.state, d.err = true, hwConfirm, nil
	h.mu.Unlock()
	go h.openTrezor(d, secret)
	return nil
}

// use runs fn on the device id, once it is ready, holding it for the
// request.
func (h *hardware) use(id string, fn func(*hwDevice) error) error {
	if _, err := h.refresh(); err != nil {
		return err
	}
	h.mu.Lock()
	d := h.devs[id]
	h.mu.Unlock()
	if d == nil {
		return ErrHardwareUnknown
	}
	return h.run(d, false, fn)
}

// run runs fn on a ready device, once what holds it lets go. A quick
// exchange (an address read, a scan, the state looked at) is waited for; a
// request waiting on the user at the device isn't: it could be minutes,
// and the device is busy until they answer. With confirm set fn is one,
// and marks the device busy meanwhile.
func (h *hardware) run(d *hwDevice, confirm bool, fn func(*hwDevice) error) error {
	if err := h.ready(d); err != nil {
		return err
	}
	d.op.Lock()
	defer d.op.Unlock()
	h.mu.Lock()
	if d.busy {
		// Another request waiting on the user took it first
		h.mu.Unlock()
		return ErrHardwareBusy
	}
	d.busy = confirm
	h.mu.Unlock()
	if confirm {
		defer func() {
			h.mu.Lock()
			d.busy = false
			h.mu.Unlock()
		}()
	}
	err := fn(d)
	if errors.Is(err, usbwallet.ErrTrezorPINNeeded) || errors.Is(err, usbwallet.ErrTrezorPassphraseNeeded) {
		// It locked itself since it was opened: open it afresh, PIN and all
		h.forget(d)
	}
	return hardwareError(err)
}

// ready reports why a device can't take a request now, nil if it can.
func (h *hardware) ready(d *hwDevice) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch {
	case d.busy:
		return ErrHardwareBusy
	case d.state == hwReady:
		return nil
	case d.state == hwLocked:
		return ErrHardwareLocked
	case d.state == hwApp:
		return ErrHardwareAppClosed
	case d.state == hwAccess:
		return ErrHardwareAccess
	case d.err != nil && d.state == hwFailed:
		return d.err
	}
	return ErrHardwareNotReady
}

// account finds the connected device that holds ref and runs fn with it
// and the account, pinned at its path for the device to sign with. A
// device of ref's kind that holds another wallet, or derives another
// address, is passed over; with none that holds it, the error says why the
// likeliest one can't. It returns the wallet the device that held it holds.
func (h *hardware) account(ref hardwareRef, fn func(d *hwDevice, acc wallet.Account) error) (util.Address, error) {
	path, err := wallet.ParseDerivationPath(ref.Path)
	if err != nil {
		return util.Address{}, err
	}
	devs, err := h.refresh()
	if err != nil {
		return util.Address{}, err
	}
	want := util.HexToAddress(ref.Address)
	var why error
	for _, d := range devs {
		if d.kind != ref.Device {
			continue
		}
		h.mu.Lock()
		other := ref.Wallet != "" && d.wallet != (util.Address{}) && d.wallet.Hex() != ref.Wallet
		h.mu.Unlock()
		if other {
			if why == nil {
				why = ErrHardwareMismatch
			}
			continue
		}
		var (
			matched bool
			held    util.Address
		)
		err := h.run(d, true, func(d *hwDevice) error {
			acc, err := d.w.Derive(path, true)
			if err != nil {
				return err
			}
			if acc.Address != want {
				return ErrHardwareMismatch
			}
			matched = true
			if held, err = h.walletOf(d); err != nil {
				return err
			}
			return fn(d, acc)
		})
		if matched || err == nil {
			return held, err
		}
		if why == nil || why == ErrHardwareMismatch {
			why = err
		}
	}
	if why == nil {
		return util.Address{}, ErrHardwareNoDevice
	}
	return util.Address{}, why
}

// deviceName is a kind of device as people call it.
func deviceName(kind string) string {
	switch kind {
	case DeviceLedger:
		return "Ledger"
	case DeviceTrezor:
		return "Trezor"
	}
	return kind
}

// hardwareRetry reports whether err is a hardware wallet that wasn't ready
// to sign (not connected, locked, without its app open, busy): one the
// user can put right and try again, as they can't a request turned down.
func hardwareRetry(err error) bool {
	for _, e := range []error{ErrHardwareNoDevice, ErrHardwareUnknown, ErrHardwareMismatch, ErrHardwareLocked,
		ErrHardwareAppClosed, ErrHardwareNotReady, ErrHardwareBusy, ErrHardwareAccess, ErrHardwareBlind} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}

// hardwareError turns what a device or its driver replied into the error
// the frontend tells.
func hardwareError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, usbwallet.ErrLedgerDenied), errors.Is(err, usbwallet.ErrTrezorDenied):
		return ErrHardwareDenied
	case errors.Is(err, usbwallet.ErrLedgerLocked), errors.Is(err, usbwallet.ErrTrezorPINNeeded),
		errors.Is(err, usbwallet.ErrTrezorPassphraseNeeded):
		return ErrHardwareLocked
	case errors.Is(err, usbwallet.ErrLedgerAppClosed), errors.Is(err, wallet.ErrWalletClosed):
		return ErrHardwareAppClosed
	case errors.Is(err, usbwallet.ErrLedgerBlindSigning):
		return ErrHardwareBlind
	case errors.Is(err, usbwallet.ErrTrezorPINInvalid):
		return ErrHardwarePIN
	case strings.HasPrefix(err.Error(), "signer mismatch"):
		return ErrHardwareMismatch
	case strings.HasPrefix(err.Error(), "hardware: "), strings.HasPrefix(err.Error(), "wallet: "):
		return err
	}
	return fmt.Errorf("hardware: %w", err)
}

// ---------------------------------------------------------------------------
// The wallet's hardware accounts
// ---------------------------------------------------------------------------

// hardwareOf returns where a hardware wallet account is, if addr is one.
func (w *Wallet) hardwareOf(addr util.Address) (hardwareRef, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.hardwareOfLocked(addr.Hex())
}

// hardwareOfLocked is hardwareOf for a caller holding w.mu, by checksummed
// address.
func (w *Wallet) hardwareOfLocked(addr string) (hardwareRef, bool) {
	for _, ref := range w.meta.Hardware {
		if ref.Address == addr {
			return ref, true
		}
	}
	return hardwareRef{}, false
}

// isHardware reports whether acc, as find returns it, is a hardware wallet
// account's.
func isHardware(acc wallet.Account) bool {
	return acc.URL.Scheme == DeviceLedger || acc.URL.Scheme == DeviceTrezor
}

// HardwareDevices lists the Ledgers and Trezors connected, each with its
// state. A Trezor first seen is opened, which has it ask for its PIN and
// passphrase if it is protected by them.
func (w *Wallet) HardwareDevices() ([]HardwareDevice, error) {
	if err := w.requireOpen(); err != nil {
		return nil, err
	}
	devs, err := w.hw.list()
	if err != nil {
		return nil, err
	}
	w.claimHardware()
	return devs, nil
}

// claimHardware gives the accounts added before hardware wallets were told
// apart the wallet of a ready device that holds them, checking each such
// device once while it stays plugged in: the address at each one's path,
// derived on it, says whether it does.
func (w *Wallet) claimHardware() {
	h := &w.hw
	h.mu.Lock()
	var devs []*hwDevice
	for _, d := range h.devs {
		if d.state == hwReady && !d.busy && !d.claimed && d.wallet != (util.Address{}) {
			devs = append(devs, d)
		}
	}
	h.mu.Unlock()
	for _, d := range devs {
		w.mu.Lock()
		var refs []hardwareRef
		for _, ref := range w.meta.Hardware {
			if ref.Wallet == "" && ref.Device == d.kind {
				refs = append(refs, ref)
			}
		}
		w.mu.Unlock()
		var mine []string
		err := h.run(d, false, func(d *hwDevice) error {
			for _, ref := range refs {
				path, err := wallet.ParseDerivationPath(ref.Path)
				if err != nil {
					continue
				}
				acc, err := d.w.Derive(path, false)
				if err != nil {
					return err
				}
				if acc.Address.Hex() == ref.Address {
					mine = append(mine, ref.Address)
				}
			}
			return nil
		})
		if err != nil {
			continue
		}
		h.mu.Lock()
		d.claimed = true
		id := d.wallet
		h.mu.Unlock()
		if len(mine) > 0 {
			w.assignHardware(id, d.kind, mine...)
		}
	}
}

// assignHardware puts accounts on the hardware wallet id (of kind), named
// "Hardware Wallet N" if the wallet has none of that ID yet.
func (w *Wallet) assignHardware(id util.Address, kind string, addrs ...string) {
	if id == (util.Address{}) {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	changed := w.ensureHardwareWalletLocked(id.Hex(), kind)
	for i, ref := range w.meta.Hardware {
		if ref.Wallet == "" && slices.Contains(addrs, ref.Address) {
			w.meta.Hardware[i].Wallet = id.Hex()
			changed = true
		}
	}
	if !changed {
		return
	}
	if err := w.saveMeta(); err != nil {
		logging.Warn("Failed to save the wallet's labels", "err", err)
	}
}

// ensureHardwareWalletLocked records the hardware wallet id if the wallet
// has none of it, named "Hardware Wallet N" as new accounts are named: N
// one past the hardware wallets there are, skipping the numbers one goes
// by already. It reports whether it was new. The caller holds w.mu and
// saves the labels.
func (w *Wallet) ensureHardwareWalletLocked(id, kind string) bool {
	taken := map[string]bool{}
	for _, hw := range w.meta.HardwareWallets {
		if hw.ID == id {
			return false
		}
		taken[hw.Name] = true
	}
	n := len(w.meta.HardwareWallets) + 1
	for taken[fmt.Sprintf("Hardware Wallet %d", n)] {
		n++
	}
	w.meta.HardwareWallets = append(w.meta.HardwareWallets, hardwareWalletMeta{ID: id, Device: kind, Name: fmt.Sprintf("Hardware Wallet %d", n)})
	return true
}

// hardwareInfosLocked lists the hardware wallets, in the order they were
// first seen, each with how many of its accounts the wallet has. The
// caller holds w.mu.
func (w *Wallet) hardwareInfosLocked() []HardwareWalletInfo {
	counts := map[string]int{}
	for _, ref := range w.meta.Hardware {
		counts[ref.Wallet]++
	}
	out := []HardwareWalletInfo{}
	for _, hw := range w.meta.HardwareWallets {
		out = append(out, HardwareWalletInfo{ID: hw.ID, Kind: hw.Device, Name: hw.Name, Accounts: counts[hw.ID]})
	}
	return out
}

// RenameHardwareWallet names a hardware wallet; an empty name keeps the one
// it has, as a phrase's does.
func (w *Wallet) RenameHardwareWallet(id, name string) error {
	if err := w.requireOpen(); err != nil {
		return err
	}
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for i, hw := range w.meta.HardwareWallets {
		if hw.ID != id {
			continue
		}
		if name != "" {
			w.meta.HardwareWallets[i].Name = name
		}
		return w.saveMeta()
	}
	return ErrUnknownHardwareWallet
}

// HardwareUnlock gives a Trezor One the PIN it asked for, as the positions
// on the pad it shows (1 to 9, from the bottom left as on a numeric
// keypad), or the passphrase it asked for.
func (w *Wallet) HardwareUnlock(id, secret string) error {
	if err := w.requireOpen(); err != nil {
		return err
	}
	if len(secret) > maxPassphrase {
		return ErrLongPassphrase
	}
	return w.hw.unlock(id, secret)
}

// HardwareScan lists count accounts a connected device holds under scheme
// from index from, with what each holds, as ScanSeed does for a phrase.
// Nothing is stored.
func (w *Wallet) HardwareScan(id, scheme string, from, count uint32) ([]SeedCandidate, error) {
	if err := w.requireOpen(); err != nil {
		return nil, err
	}
	if count == 0 || count > maxScan || from > maxSeedIndex {
		return nil, errors.New("wallet: scan out of range")
	}
	var out []SeedCandidate
	err := w.hw.use(id, func(d *hwDevice) error {
		var err error
		out, err = w.candidates(scheme, from, count, func(path wallet.DerivationPath) (string, error) {
			acc, err := d.w.Derive(path, false)
			return acc.Address.Hex(), err
		})
		return err
	})
	return out, err
}

// AddHardwareAccounts brings in the accounts picked from a scan of the
// device id, each derived on it again: the frontend's word isn't taken for
// any address. Those the wallet has already are passed over. The first
// added is returned, and selected unless an account was before.
func (w *Wallet) AddHardwareAccounts(id string, picks []SeedPick) (WalletAccount, error) {
	if err := w.requireOpen(); err != nil {
		return WalletAccount{}, err
	}
	if len(picks) == 0 {
		return WalletAccount{}, errors.New("wallet: no accounts picked")
	}
	paths, names, err := pickedPaths(picks)
	if err != nil {
		return WalletAccount{}, err
	}
	var (
		kind   string
		holder util.Address
		addrs  = make([]util.Address, len(paths))
	)
	err = w.hw.use(id, func(d *hwDevice) error {
		kind = d.kind
		var err error
		if holder, err = w.hw.walletOf(d); err != nil {
			return err
		}
		for i, path := range paths {
			acc, err := d.w.Derive(path, false)
			if err != nil {
				return err
			}
			addrs[i] = acc.Address
		}
		return nil
	})
	if err != nil {
		return WalletAccount{}, err
	}
	var first string
	for i, addr := range addrs {
		if _, _, err := w.known(addr.Hex()); err == nil {
			continue
		}
		hex := addr.Hex()
		w.mu.Lock()
		w.ensureHardwareWalletLocked(holder.Hex(), kind)
		w.meta.Hardware = append(w.meta.Hardware, hardwareRef{Address: hex, Device: kind, Path: paths[i].String(), Wallet: holder.Hex()})
		if names[i] != "" {
			w.meta.Names[hex] = names[i]
		}
		// The device's own recovery phrase backs it up
		w.meta.BackedUp[hex] = true
		if first == "" {
			first = hex
			if w.meta.Selected == "" {
				w.meta.Selected = hex
			}
		}
		w.mu.Unlock()
	}
	if first == "" {
		return WalletAccount{}, ErrAccountsInWallet
	}
	w.mu.Lock()
	err = w.saveMeta()
	w.mu.Unlock()
	if err != nil {
		return WalletAccount{}, err
	}
	logging.Info("Added hardware wallet accounts", "device", kind, "account", first, "picked", len(paths))
	return w.accountView(first), nil
}

// RemoveHardware stops following a hardware wallet account. It needs no
// password: the key never left the device.
func (w *Wallet) RemoveHardware(address string) error {
	if err := w.requireOpen(); err != nil {
		return err
	}
	addr, err := parseRecipient(address)
	if err != nil {
		return ErrUnknownAccount
	}
	hex := addr.Hex()
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.hardwareOfLocked(hex); !ok {
		return ErrUnknownAccount
	}
	ref, _ := w.hardwareOfLocked(hex)
	kept := w.meta.Hardware[:0:0]
	used := false
	for _, r := range w.meta.Hardware {
		if r.Address != hex {
			kept = append(kept, r)
			used = used || r.Wallet == ref.Wallet
		}
	}
	w.meta.Hardware = kept
	// Its wallet goes with its last account, as there is nothing of it left
	// to show
	if !used && ref.Wallet != "" {
		w.meta.HardwareWallets = slices.DeleteFunc(w.meta.HardwareWallets, func(hw hardwareWalletMeta) bool { return hw.ID == ref.Wallet })
	}
	delete(w.meta.Names, hex)
	delete(w.meta.BackedUp, hex)
	if w.meta.Selected == hex {
		w.meta.Selected = ""
	}
	return w.saveMeta()
}

// HardwareShowAddress shows a hardware wallet account's address on the
// device's screen, for the user to check it against the one the app shows
// before they share it; it returns once they confirm it there.
func (w *Wallet) HardwareShowAddress(address string) error {
	if err := w.requireOpen(); err != nil {
		return err
	}
	acc, err := w.find(address)
	if err != nil {
		return err
	}
	ref, ok := w.hardwareOf(acc.Address)
	if !ok {
		return ErrUnknownAccount
	}
	held, err := w.hw.account(ref, func(d *hwDevice, acc wallet.Account) error {
		shower, ok := d.w.(interface {
			ShowAddress(wallet.DerivationPath) (util.Address, error)
		})
		if !ok {
			return wallet.ErrNotSupported
		}
		path, _ := wallet.ParseDerivationPath(ref.Path)
		shown, err := shower.ShowAddress(path)
		if err != nil {
			return err
		}
		if shown != acc.Address {
			return ErrHardwareMismatch
		}
		return nil
	})
	if err == nil {
		w.assignHardware(held, ref.Device, ref.Address)
	}
	return err
}

// signHardware has the device that holds acc sign tx for chainID, once the
// user confirms it on the device's screen.
func (w *Wallet) signHardware(acc wallet.Account, tx *types.Transaction, chainID *big.Int) (*types.Transaction, error) {
	ref, ok := w.hardwareOf(acc.Address)
	if !ok {
		return nil, ErrUnknownAccount
	}
	var signed *types.Transaction
	held, err := w.hw.account(ref, func(d *hwDevice, acc wallet.Account) error {
		var err error
		signed, err = d.w.SignTx(acc, tx, chainID)
		return err
	})
	if err != nil {
		return nil, err
	}
	w.assignHardware(held, ref.Device, ref.Address)
	logging.Info("Signed a transaction on a hardware wallet", "device", ref.Device, "from", acc.Address)
	return signed, nil
}

// signTextHardware has the device that holds acc sign msg the EIP-191 way,
// once the user confirms it on the device's screen: [R || S || V], V 0 or 1.
func (w *Wallet) signTextHardware(acc wallet.Account, msg []byte) ([]byte, error) {
	ref, ok := w.hardwareOf(acc.Address)
	if !ok {
		return nil, ErrUnknownAccount
	}
	var sig []byte
	held, err := w.hw.account(ref, func(d *hwDevice, acc wallet.Account) error {
		var err error
		sig, err = d.w.SignText(acc, msg)
		return err
	})
	if err == nil {
		w.assignHardware(held, ref.Device, ref.Address)
	}
	return sig, err
}
