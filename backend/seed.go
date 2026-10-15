// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/tyler-smith/go-bip39"
	"golang.org/x/text/unicode/norm"
)

// Recovery phrases: BIP-39 mnemonics, each with an optional BIP-39
// passphrase, from which accounts are derived along the paths wallets use
// (BIP-32, BIP-44), so the same words (and passphrase) restore the same
// accounts here, in MetaMask and in hardware wallets. Nothing here is new
// cryptography: the words and their checksum are go-bip39's, the
// derivation btcd's hdkeychain, and the encryption the daemon's keystore.
//
// A wallet may hold several phrases. Each is kept in the vault (vault.go),
// its entropy and passphrase encrypted with the wallet password; each
// account derived from one goes into the keystore under the same password,
// so sending and the other account actions don't touch the phrase. A
// phrase is decrypted only to derive accounts or to show it to its owner,
// and the decrypted bytes are cleared after use. (The words pass through
// Go strings, which can't be cleared; they are dropped as soon as the call
// returns.)

var (
	ErrSeedExists     = errors.New("wallet: this recovery phrase is already in the wallet")
	ErrBadMnemonic    = errors.New("wallet: not a valid recovery phrase")
	ErrLongPassphrase = errors.New("wallet: the passphrase is too long")
	// ErrAccountsInWallet: every account picked is in the wallet already
	ErrAccountsInWallet = errors.New("wallet: the accounts picked are already in the wallet")
)

const (
	// seedEntropyBits makes a 12-word phrase, as MetaMask does: 128 bits.
	seedEntropyBits = 128
	maxPassphrase   = 1024
)

// Derivation schemes: the paths wallets commonly put accounts at under a
// phrase. Standard is MetaMask's (and Trezor's, and most wallets'); the
// others let a phrase from a Ledger restore what Ledger Live or its older
// apps made from it. The daemon's wallet package defines their bases.
const (
	SchemeStandard   = "standard"   // m/44'/60'/0'/0/n
	SchemeLedgerLive = "ledgerlive" // m/44'/60'/n'/0/0
	SchemeLegacy     = "legacy"     // m/44'/60'/0'/n
)

// maxScan bounds one scan, and maxSeedIndex how deep a scan may go.
const (
	maxScan      = 20
	maxSeedIndex = 1000
)

// SeedInfo is one recovery phrase as the frontend shows it: nothing
// secret.
type SeedInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Confirmed     bool   `json:"confirmed"`
	HasPassphrase bool   `json:"hasPassphrase"`
	Accounts      int    `json:"accounts"`
}

// SeedPhrase is a phrase made or shown for its owner: its words, its
// passphrase if it has one, and the account made with it, if any.
type SeedPhrase struct {
	SeedID     string        `json:"seedId"`
	Words      []string      `json:"words"`
	Passphrase string        `json:"passphrase"`
	Account    WalletAccount `json:"account"`
}

// SeedPick is one account chosen from a scan of a phrase, and the name it
// takes (none if empty).
type SeedPick struct {
	Scheme string `json:"scheme"`
	Index  uint32 `json:"index"`
	Name   string `json:"name,omitempty"`
}

// SeedCandidate is one account a phrase holds, as a scan found it: where,
// what it holds at the chain head, and whether the wallet has it already.
type SeedCandidate struct {
	Scheme     string `json:"scheme"`
	Index      uint32 `json:"index"`
	Path       string `json:"path"`
	Address    string `json:"address"`
	BalanceWei string `json:"balanceWei"` // empty while the node can't read the state
	Nonce      uint64 `json:"nonce"`
	Used       bool   `json:"used"` // it holds LAX or has sent a transaction
	InWallet   bool   `json:"inWallet"`
}

// seedMeta is what the wallet keeps of a phrase in wallet.json: nothing
// secret.
type seedMeta struct {
	Name      string `json:"name"`
	Confirmed bool   `json:"confirmed"`
	Next      uint32 `json:"next"` // the standard index the next account takes
}

// seedRef ties an account to the phrase it comes from, and where.
type seedRef struct {
	Seed string `json:"seed"`
	Path string `json:"path"`
}

// schemePath is the path of account index under scheme.
func schemePath(scheme string, index uint32) (wallet.DerivationPath, error) {
	if index > maxSeedIndex {
		return nil, errors.New("wallet: account index out of range")
	}
	switch scheme {
	case SchemeStandard:
		p := append(wallet.DerivationPath{}, wallet.DefaultBaseDerivationPath...)
		p[len(p)-1] = index
		return p, nil
	case SchemeLedgerLive:
		p := append(wallet.DerivationPath{}, wallet.DefaultBaseDerivationPath...)
		p[2] = 0x80000000 + index
		return p, nil
	case SchemeLegacy:
		p := append(wallet.DerivationPath{}, wallet.LegacyLedgerBaseDerivationPath...)
		p[len(p)-1] = index
		return p, nil
	}
	return nil, fmt.Errorf("wallet: unknown derivation scheme %q", scheme)
}

// standardIndex reports the index of a path under the standard scheme.
func standardIndex(path string) (uint32, bool) {
	p, err := wallet.ParseDerivationPath(path)
	base := wallet.DefaultBaseDerivationPath
	if err != nil || len(p) != len(base) {
		return 0, false
	}
	for i := 0; i < len(base)-1; i++ {
		if p[i] != base[i] {
			return 0, false
		}
	}
	return p[len(p)-1], true
}

// entropyFromWords reads a phrase as typed: any case, any spacing. Its words
// must be BIP-39 English words and its checksum must hold.
func entropyFromWords(mnemonic string) ([]byte, error) {
	words := strings.Fields(strings.ToLower(mnemonic))
	switch len(words) {
	case 12, 15, 18, 21, 24:
	default:
		return nil, ErrBadMnemonic
	}
	phrase := strings.Join(words, " ")
	if !bip39.IsMnemonicValid(phrase) {
		return nil, ErrBadMnemonic
	}
	entropy, err := bip39.EntropyFromMnemonic(phrase)
	if err != nil {
		return nil, ErrBadMnemonic
	}
	return entropy, nil
}

// normPassphrase puts a BIP-39 passphrase in the form BIP-39 hashes (NFKD),
// as Trezor and Ledger do, so one typed with accents restores the same
// accounts there. Spaces count: it is otherwise kept as typed.
func normPassphrase(p string) (string, error) {
	if len(p) > maxPassphrase || !utf8.ValidString(p) {
		return "", ErrLongPassphrase
	}
	return norm.NFKD.String(p), nil
}

// fingerprint is the address of a phrase's first standard account under a
// passphrase: public, and the same for the same phrase and passphrase.
func fingerprint(entropy []byte, passphrase string) (string, error) {
	path, _ := schemePath(SchemeStandard, 0)
	return deriveAddress(entropy, passphrase, path)
}

// ScanSeed lists count accounts of a phrase (with passphrase) under scheme
// from index from, with what each holds, read from the node's state at its
// head, so the user can choose which to bring in. Nothing is stored.
func (w *Wallet) ScanSeed(words, passphrase, scheme string, from, count uint32) ([]SeedCandidate, error) {
	if count == 0 || count > maxScan || from > maxSeedIndex {
		return nil, errors.New("wallet: scan out of range")
	}
	entropy, err := entropyFromWords(words)
	if err != nil {
		return nil, err
	}
	defer clear(entropy)
	if passphrase, err = normPassphrase(passphrase); err != nil {
		return nil, err
	}
	return w.scan(entropy, passphrase, scheme, from, count)
}

// ScanWalletSeed is ScanSeed for a phrase the wallet holds, once the
// wallet password opens it, so the accounts it has beyond those in the
// wallet can be found without typing its words again.
func (w *Wallet) ScanWalletSeed(seedID, password, scheme string, from, count uint32) ([]SeedCandidate, error) {
	if count == 0 || count > maxScan || from > maxSeedIndex {
		return nil, errors.New("wallet: scan out of range")
	}
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	_, s, _, err := w.seedFor(seedID, password)
	if err != nil {
		return nil, err
	}
	entropy, pass, err := openSeed(s, password)
	if err != nil {
		return nil, err
	}
	defer clear(entropy)
	defer clear(pass)
	return w.scan(entropy, string(pass), scheme, from, count)
}

// scan is ScanSeed once the phrase is read: its entropy, and its
// passphrase normalised.
func (w *Wallet) scan(entropy []byte, passphrase, scheme string, from, count uint32) ([]SeedCandidate, error) {
	// The head state, if the node has one: missing while stopped or snap
	// syncing, when the scan shows addresses only
	type reader interface {
		GetBalance(util.Address) *big.Int
		GetNonce(util.Address) uint64
	}
	var state reader
	if w.node != nil {
		if prl := w.node.Parallax(); prl != nil {
			if st, err := prl.BlockChain().State(); err == nil {
				state = st
			}
		}
	}

	out := make([]SeedCandidate, 0, count)
	for i := from; i < from+count; i++ {
		path, err := schemePath(scheme, i)
		if err != nil {
			return nil, err
		}
		hexAddr, err := deriveAddress(entropy, passphrase, path)
		if err != nil {
			return nil, err
		}
		addr := util.HexToAddress(hexAddr)
		c := SeedCandidate{Scheme: scheme, Index: i, Path: path.String(), Address: hexAddr, InWallet: w.ks.HasAddress(addr)}
		if state != nil {
			bal := state.GetBalance(addr)
			c.BalanceWei = bal.String()
			c.Nonce = state.GetNonce(addr)
			c.Used = bal.Sign() > 0 || c.Nonce > 0
		}
		out = append(out, c)
	}
	return out, nil
}

// CreateSeed makes a new recovery phrase from the operating system's random
// source, with passphrase if not empty, and its first account. The phrase
// is encrypted with the wallet password (set by this call if the wallet
// has none yet). The words are returned once, for the user to write down.
func (w *Wallet) CreateSeed(name, password, passphrase string) (SeedPhrase, error) {
	name, err := cleanName(name)
	if err != nil {
		return SeedPhrase{}, err
	}
	if passphrase, err = normPassphrase(passphrase); err != nil {
		return SeedPhrase{}, err
	}
	entropy, err := bip39.NewEntropy(seedEntropyBits)
	if err != nil {
		return SeedPhrase{}, err
	}
	defer clear(entropy)
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return SeedPhrase{}, err
	}

	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	first, _ := schemePath(SchemeStandard, 0)
	id, acc, err := w.storeSeed(entropy, passphrase, []string{name}, password, false, []wallet.DerivationPath{first})
	if err != nil {
		return SeedPhrase{}, err
	}
	logging.Info("Created a recovery phrase", "account", acc.Address)
	return SeedPhrase{SeedID: id, Words: strings.Fields(mnemonic), Passphrase: passphrase, Account: acc}, nil
}

// NewSeedWords makes the words of a new recovery phrase from the operating
// system's random source, 12 (128 bits, as MetaMask makes) or 24 (256
// bits, as hardware wallets do), for the user to write down and confirm
// before anything is stored: CreateSeedWords stores them once they have,
// with the passphrase chosen then, if any.
func (w *Wallet) NewSeedWords(count int) ([]string, error) {
	var bits int
	switch count {
	case 12:
		bits = 128
	case 24:
		bits = 256
	default:
		return nil, errors.New("wallet: a new recovery phrase has 12 or 24 words")
	}
	entropy, err := bip39.NewEntropy(bits)
	if err != nil {
		return nil, err
	}
	defer clear(entropy)
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return nil, err
	}
	return strings.Fields(mnemonic), nil
}

// CreateSeedWords stores a recovery phrase NewSeedWords made, with
// passphrase if not empty, encrypted with the wallet password, and makes
// its first account, named name and selected. confirmed records whether
// the user proved they wrote the words down.
func (w *Wallet) CreateSeedWords(name, mnemonic, passphrase, password string, confirmed bool) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	entropy, err := entropyFromWords(mnemonic)
	if err != nil {
		return WalletAccount{}, err
	}
	defer clear(entropy)
	if passphrase, err = normPassphrase(passphrase); err != nil {
		return WalletAccount{}, err
	}

	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	first, _ := schemePath(SchemeStandard, 0)
	_, acc, err := w.storeSeed(entropy, passphrase, []string{name}, password, confirmed, []wallet.DerivationPath{first})
	if err != nil {
		return WalletAccount{}, err
	}
	logging.Info("Created a recovery phrase", "account", acc.Address)
	return acc, nil
}

// ImportSeed brings a recovery phrase (with passphrase if not empty) into
// the wallet, encrypted with the wallet password, and makes the accounts
// picked from a scan of it (the first standard account when none are),
// each with its pick's name. A name given goes to the first instead.
func (w *Wallet) ImportSeed(name, mnemonic, passphrase, password string, picks []SeedPick) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	entropy, err := entropyFromWords(mnemonic)
	if err != nil {
		return WalletAccount{}, err
	}
	defer clear(entropy)
	if passphrase, err = normPassphrase(passphrase); err != nil {
		return WalletAccount{}, err
	}
	if len(picks) == 0 {
		picks = []SeedPick{{Scheme: SchemeStandard, Index: 0}}
	}
	paths, names, err := pickedPaths(picks)
	if err != nil {
		return WalletAccount{}, err
	}
	// The name given goes to the first, before any its pick has
	if name != "" {
		names[0] = name
	}

	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	// The user brought the words: they are already written down
	_, acc, err := w.storeSeed(entropy, passphrase, names, password, true, paths)
	if err != nil {
		return WalletAccount{}, err
	}
	logging.Info("Imported a recovery phrase", "account", acc.Address, "accounts", len(paths))
	return acc, nil
}

// pickedPaths is where the accounts picked from a scan are, and the names
// they take.
func pickedPaths(picks []SeedPick) ([]wallet.DerivationPath, []string, error) {
	if len(picks) > maxScan*3 {
		return nil, nil, errors.New("wallet: too many accounts picked")
	}
	paths := make([]wallet.DerivationPath, len(picks))
	names := make([]string, len(picks))
	for i, p := range picks {
		var err error
		if paths[i], err = schemePath(p.Scheme, p.Index); err != nil {
			return nil, nil, err
		}
		if names[i], err = cleanName(p.Name); err != nil {
			return nil, nil, err
		}
	}
	return paths, names, nil
}

// storeSeed adds a phrase to the vault, encrypted with the wallet password,
// and makes the accounts at paths from it, each named by names (in step
// with paths), the first selected. The caller holds w.keyMu.
func (w *Wallet) storeSeed(entropy []byte, passphrase string, names []string, password string, confirmed bool, paths []wallet.DerivationPath) (string, WalletAccount, error) {
	v, err := w.unlockVault(password)
	if err != nil {
		return "", WalletAccount{}, err
	}
	fp, err := fingerprint(entropy, passphrase)
	if err != nil {
		return "", WalletAccount{}, err
	}
	for _, s := range v.Seeds {
		if s.Fingerprint == fp {
			return "", WalletAccount{}, ErrSeedExists
		}
	}
	id, err := newSeedID()
	if err != nil {
		return "", WalletAccount{}, err
	}
	s := vaultSeed{ID: id, Fingerprint: fp}
	if s.Entropy, err = encrypt(entropy, password); err != nil {
		return "", WalletAccount{}, err
	}
	if passphrase != "" {
		p, err := encrypt([]byte(passphrase), password)
		if err != nil {
			return "", WalletAccount{}, err
		}
		s.Passphrase = &p
	}
	v.Seeds = append(v.Seeds, s)
	if err := w.saveVault(v); err != nil {
		return "", WalletAccount{}, err
	}

	var first string
	next := uint32(0)
	for i, path := range paths {
		addr, err := w.deriveAccount(entropy, passphrase, id, path, names[i], password)
		if err != nil {
			if i == 0 {
				// Without its first account the phrase is of no use: take it out
				v.Seeds = v.Seeds[:len(v.Seeds)-1]
				_ = w.saveVault(v)
			}
			return "", WalletAccount{}, err
		}
		if first == "" {
			first = addr
		}
		if idx, ok := standardIndex(path.String()); ok && idx+1 > next {
			next = idx + 1
		}
	}

	w.mu.Lock()
	w.meta.Seeds[id] = seedMeta{Name: fmt.Sprintf("Recovery phrase %d", len(v.Seeds)), Confirmed: confirmed, Next: next}
	w.meta.Selected = first
	err = w.saveMeta()
	w.mu.Unlock()
	if err != nil {
		logging.Warn("Failed to save the wallet's labels", "err", err)
	}
	return id, w.accountView(first), nil
}

// seedFor returns the vault's phrase with id, once password proves to be
// the wallet's. The caller holds w.keyMu.
func (w *Wallet) seedFor(id, password string) (*vaultFile, vaultSeed, int, error) {
	v, err := w.loadVault()
	if err != nil {
		return nil, vaultSeed{}, -1, err
	}
	if v == nil {
		return nil, vaultSeed{}, -1, ErrUnknownSeed
	}
	for i, s := range v.Seeds {
		if s.ID == id {
			if err := verifyPassword(v, password); err != nil {
				return nil, vaultSeed{}, -1, err
			}
			return v, s, i, nil
		}
	}
	return nil, vaultSeed{}, -1, ErrUnknownSeed
}

// DeriveAccount makes the next standard account from a recovery phrase.
func (w *Wallet) DeriveAccount(seedID, name, password string) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	_, s, _, err := w.seedFor(seedID, password)
	if err != nil {
		return WalletAccount{}, err
	}
	entropy, pass, err := openSeed(s, password)
	if err != nil {
		return WalletAccount{}, err
	}
	defer clear(entropy)
	defer clear(pass)

	w.mu.Lock()
	index := w.meta.Seeds[seedID].Next
	w.mu.Unlock()
	// An index whose account is already in the wallet (imported on its own)
	// is skipped: the user asked for a new one
	for tries := 0; tries < 100; tries++ {
		path, err := schemePath(SchemeStandard, index)
		if err != nil {
			return WalletAccount{}, err
		}
		index++
		addr, err := deriveAddress(entropy, string(pass), path)
		if err != nil {
			return WalletAccount{}, err
		}
		if w.ks.HasAddress(util.HexToAddress(addr)) {
			continue
		}
		if _, err := w.deriveAccount(entropy, string(pass), seedID, path, name, password); err != nil {
			return WalletAccount{}, err
		}
		w.mu.Lock()
		m := w.meta.Seeds[seedID]
		m.Next = index
		w.meta.Seeds[seedID] = m
		err = w.saveMeta()
		w.mu.Unlock()
		if err != nil {
			logging.Warn("Failed to save the wallet's labels", "err", err)
		}
		logging.Info("Derived an account from a recovery phrase", "address", addr, "path", path)
		return w.accountView(addr), nil
	}
	return WalletAccount{}, errors.New("wallet: no free account index found")
}

// AddSeedAccounts makes the accounts picked from a scan of a phrase the
// wallet holds (ScanWalletSeed), each with its pick's name, skipping those
// already in the wallet. The
// first one made is returned; the account selected stays so, as these add
// to a phrase the user has rather than bring in a new one. The standard
// index carries on after the picks.
func (w *Wallet) AddSeedAccounts(seedID, password string, picks []SeedPick) (WalletAccount, error) {
	if len(picks) == 0 {
		return WalletAccount{}, errors.New("wallet: no accounts picked")
	}
	paths, names, err := pickedPaths(picks)
	if err != nil {
		return WalletAccount{}, err
	}
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	_, s, _, err := w.seedFor(seedID, password)
	if err != nil {
		return WalletAccount{}, err
	}
	entropy, pass, err := openSeed(s, password)
	if err != nil {
		return WalletAccount{}, err
	}
	defer clear(entropy)
	defer clear(pass)

	w.mu.Lock()
	next := w.meta.Seeds[seedID].Next
	selected := w.meta.Selected
	w.mu.Unlock()
	// deriveAccount selects each account it makes: the one selected before
	// stays so (or, with none, the first made), on failure part-way too
	defer func() {
		if selected != "" {
			w.mu.Lock()
			w.meta.Selected = selected
			w.mu.Unlock()
		}
	}()
	var first string
	for i, path := range paths {
		addr, err := deriveAddress(entropy, string(pass), path)
		if err != nil {
			return WalletAccount{}, err
		}
		if w.ks.HasAddress(util.HexToAddress(addr)) {
			continue
		}
		if _, err := w.deriveAccount(entropy, string(pass), seedID, path, names[i], password); err != nil {
			return WalletAccount{}, err
		}
		if first == "" {
			first = addr
		}
		if idx, ok := standardIndex(path.String()); ok && idx+1 > next {
			next = idx + 1
		}
	}
	if first == "" {
		return WalletAccount{}, ErrAccountsInWallet
	}

	w.mu.Lock()
	m := w.meta.Seeds[seedID]
	m.Next = next
	w.meta.Seeds[seedID] = m
	if selected != "" {
		w.meta.Selected = selected
	}
	err = w.saveMeta()
	w.mu.Unlock()
	if err != nil {
		logging.Warn("Failed to save the wallet's labels", "err", err)
	}
	logging.Info("Added accounts from a recovery phrase", "account", first, "picked", len(paths))
	return w.accountView(first), nil
}

// RevealSeed returns a recovery phrase's words, and its passphrase if it has
// one, to its owner, once the wallet password opens it.
func (w *Wallet) RevealSeed(seedID, password string) (SeedPhrase, error) {
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	_, s, _, err := w.seedFor(seedID, password)
	if err != nil {
		return SeedPhrase{}, err
	}
	entropy, pass, err := openSeed(s, password)
	if err != nil {
		return SeedPhrase{}, err
	}
	defer clear(entropy)
	defer clear(pass)
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return SeedPhrase{}, err
	}
	return SeedPhrase{SeedID: seedID, Words: strings.Fields(mnemonic), Passphrase: string(pass)}, nil
}

// ConfirmSeed records that the user wrote a recovery phrase down and proved
// it by retyping some of its words: the accounts made from it are backed
// up from then on.
func (w *Wallet) ConfirmSeed(seedID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	m, ok := w.meta.Seeds[seedID]
	if !ok {
		return ErrUnknownSeed
	}
	m.Confirmed = true
	w.meta.Seeds[seedID] = m
	return w.saveMeta()
}

// RenameSeed labels a recovery phrase; an empty name keeps the old one.
func (w *Wallet) RenameSeed(seedID, name string) error {
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	m, ok := w.meta.Seeds[seedID]
	if !ok {
		return ErrUnknownSeed
	}
	if name != "" {
		m.Name = name
	}
	w.meta.Seeds[seedID] = m
	return w.saveMeta()
}

// RemoveSeed deletes a recovery phrase and every account made from it,
// once the wallet password proves the user holds it. Without the words
// written down, their funds are lost for good.
func (w *Wallet) RemoveSeed(seedID, password string) error {
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	v, _, i, err := w.seedFor(seedID, password)
	if err != nil {
		return err
	}
	// Its accounts first: while the phrase stays, a failure partway loses
	// nothing, the phrase can make them again
	w.mu.Lock()
	var addrs []string
	for addr, ref := range w.meta.SeedOf {
		if ref.Seed == seedID {
			addrs = append(addrs, addr)
		}
	}
	w.mu.Unlock()
	sort.Strings(addrs)
	for _, addr := range addrs {
		acc, err := w.find(addr)
		if errors.Is(err, ErrUnknownAccount) {
			continue
		}
		if err != nil {
			return err
		}
		if err := w.ks.Delete(acc, password); err != nil {
			if errors.Is(err, keystore.ErrDecrypt) {
				return fmt.Errorf("%w: %s", ErrKeyMismatch, addr)
			}
			return err
		}
	}
	v.Seeds = append(v.Seeds[:i], v.Seeds[i+1:]...)
	if err := w.saveVault(v); err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, addr := range addrs {
		delete(w.meta.SeedOf, addr)
		delete(w.meta.Names, addr)
		delete(w.meta.BackedUp, addr)
		if w.meta.Selected == addr {
			w.meta.Selected = ""
		}
	}
	delete(w.meta.Seeds, seedID)
	logging.Info("Removed a recovery phrase", "accounts", len(addrs))
	return w.saveMeta()
}

// seedInfos lists the wallet's phrases for the frontend, in the order they
// were added. The caller holds w.mu.
func (w *Wallet) seedInfosLocked(v *vaultFile) []SeedInfo {
	out := []SeedInfo{}
	if v == nil {
		return out
	}
	counts := map[string]int{}
	for addr, ref := range w.meta.SeedOf {
		if w.ks.HasAddress(util.HexToAddress(addr)) {
			counts[ref.Seed]++
		}
	}
	for _, s := range v.Seeds {
		m := w.meta.Seeds[s.ID]
		out = append(out, SeedInfo{
			ID:            s.ID,
			Name:          m.Name,
			Confirmed:     m.Confirmed,
			HasPassphrase: s.Passphrase != nil,
			Accounts:      counts[s.ID],
		})
	}
	return out
}

// deriveAccount makes the account at path from a phrase and stores its key
// in the keystore, encrypted with the wallet password, recording where it
// came from. An account already in the wallet is recorded as the phrase's
// all the same. It returns the address. The caller holds w.keyMu.
func (w *Wallet) deriveAccount(entropy []byte, passphrase, seedID string, path wallet.DerivationPath, name, password string) (string, error) {
	priv, err := deriveKey(entropy, passphrase, path)
	if err != nil {
		return "", err
	}
	defer zeroPrivateKey(priv)
	addr := crypto.PubkeyToAddress(priv.PublicKey).Hex()
	if _, err := w.ks.ImportECDSA(priv, password); err != nil && !errors.Is(err, keystore.ErrAccountAlreadyExists) {
		return "", err
	}
	w.mu.Lock()
	if name != "" {
		w.meta.Names[addr] = name
	}
	w.meta.SeedOf[addr] = seedRef{Seed: seedID, Path: path.String()}
	w.meta.Selected = addr
	w.mu.Unlock()
	return addr, nil
}

// deriveAddress is the address of the account at path.
func deriveAddress(entropy []byte, passphrase string, path wallet.DerivationPath) (string, error) {
	priv, err := deriveKey(entropy, passphrase, path)
	if err != nil {
		return "", err
	}
	defer zeroPrivateKey(priv)
	return crypto.PubkeyToAddress(priv.PublicKey).Hex(), nil
}

// deriveKey derives the private key at a BIP-32 path from a BIP-39 phrase's
// entropy and passphrase (already normalised; empty for none). Every
// intermediate secret is cleared on the way.
func deriveKey(entropy []byte, passphrase string, path wallet.DerivationPath) (*ecdsa.PrivateKey, error) {
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return nil, err
	}
	seed := bip39.NewSeed(mnemonic, passphrase)
	defer clear(seed)
	key, err := hdkeychain.NewMaster(seed, &chaincfg.MainNetParams)
	if err != nil {
		return nil, err
	}
	for _, step := range path {
		child, err := key.Derive(step)
		key.Zero()
		if err != nil {
			return nil, err
		}
		key = child
	}
	defer key.Zero()
	ec, err := key.ECPrivKey()
	if err != nil {
		return nil, err
	}
	raw := ec.Serialize()
	defer clear(raw)
	ec.Zero()
	return crypto.ToECDSA(raw)
}

// accountView is an account as the frontend shows it. The caller must not
// hold w.mu.
func (w *Wallet) accountView(address string) WalletAccount {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.viewLocked(address)
}

// viewLocked is accountView for a caller holding w.mu.
func (w *Wallet) viewLocked(address string) WalletAccount {
	ref, fromSeed := w.meta.SeedOf[address]
	index, standard := standardIndex(ref.Path)
	watch := false
	for _, a := range w.meta.Watch {
		if a == address {
			watch = true
		}
	}
	return WalletAccount{
		Address:      address,
		Name:         w.meta.Names[address],
		WatchOnly:    watch,
		BackedUp:     w.meta.BackedUp[address] || fromSeed && w.meta.Seeds[ref.Seed].Confirmed,
		FromSeed:     fromSeed,
		SeedID:       ref.Seed,
		SeedPath:     ref.Path,
		SeedIndex:    index,
		SeedStandard: fromSeed && standard,
	}
}

// writePrivateFile writes data to path atomically, readable by its owner
// only.
func writePrivateFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
