// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
	"golang.org/x/crypto/nacl/box"
)

// The vault is what the wallet keeps secret beside its keystore, in
// vault.json: the wallet key (sealed.go), whose decrypting proves the
// wallet password, the key pair the logs are sealed to, and the recovery
// phrases, each encrypted with that password by the daemon's keystore
// encryption (scrypt and AES-128-CTR). Every key in the keystore
// is encrypted with the same password: one password opens the whole
// wallet, as in MetaMask, though nothing is ever left unlocked.
//
// The check is what keeps the password one password. Whatever is about to
// be encrypted is encrypted only after the check opens with the password
// given, so a mistyped password can never leave a key or a phrase under a
// password of its own.

var (
	ErrNoPassword    = errors.New("wallet: the wallet has no password yet")
	ErrNeedsSetup    = errors.New("wallet: set the wallet password first")
	ErrKeyMismatch   = errors.New("wallet: this account's key is under a different password")
	ErrSetupMismatch = errors.New("wallet: the password doesn't open every key in the wallet")
	ErrUnknownSeed   = errors.New("wallet: no such recovery phrase in this wallet")
)

// The vault's format: 1 kept a check value and the phrases' fingerprints
// in it, and everything else in the clear; 2 keeps the wallet key, and
// the fingerprints sealed with the labels. A vault of 1 becomes one of 2
// as it's first unlocked (upgradeVault).
const (
	vaultFileName = "vault.json"
	vaultFormat   = 2
)

type vaultFile struct {
	Version int `json:"version"`
	// Key is the wallet key, encrypted with the wallet password
	Key *keystore.CryptoJSON `json:"key,omitempty"`
	// Check proves the password in a vault of format 1
	Check *keystore.CryptoJSON `json:"check,omitempty"`
	// LogPublic is the key the logs are sealed to (logfile.go), and
	// LogPrivate its private half, sealed under the wallet key
	LogPublic  []byte      `json:"logPublic,omitempty"`
	LogPrivate []byte      `json:"logPrivate,omitempty"`
	Seeds      []vaultSeed `json:"seeds"`
}

// vaultSeed is one recovery phrase: its entropy and, if it has one, its
// BIP-39 passphrase, both encrypted. Fingerprint, in a vault of format 1,
// is the public address of its first standard account: format 2 keeps it
// sealed, with the phrase's name (seedMeta).
type vaultSeed struct {
	ID          string               `json:"id"`
	Entropy     keystore.CryptoJSON  `json:"entropy"`
	Passphrase  *keystore.CryptoJSON `json:"passphrase,omitempty"`
	Fingerprint string               `json:"fingerprint,omitempty"`
}

func (w *Wallet) vaultPath() string { return filepath.Join(filepath.Dir(w.metaPath), vaultFileName) }

// loadVault reads the vault; nil when the wallet has none yet. It keeps
// its previous version beside it too (sealed.go), but only across adding
// a phrase (saveVault): a previous version is never one under an old
// password, nor one with a phrase since removed, nor one of format 1,
// whose fingerprints are in the clear (saveVaultOnly).
func (w *Wallet) loadVault() (*vaultFile, error) {
	v, err := parseVault(w.vaultPath())
	if err == nil || !errors.Is(err, errVaultDamaged) {
		if v == nil && err == nil {
			// Missing: a write cut short between its two renames leaves
			// only the previous version
			if prev, perr := parseVault(previousCopy(w.vaultPath())); perr == nil && prev != nil {
				return prev, nil
			}
		}
		return v, err
	}
	prev, perr := parseVault(previousCopy(w.vaultPath()))
	if perr != nil || prev == nil {
		return nil, err
	}
	setAside(w.vaultPath())
	w.noteDamaged("vault")
	return prev, nil
}

var errVaultDamaged = errors.New("wallet: the wallet's vault is damaged")

// parseVault reads the vault at path; nil when there is none.
func parseVault(path string) (*vaultFile, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var v vaultFile
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, fmt.Errorf("%w: %v", errVaultDamaged, err)
	}
	if v.Version != 1 && v.Version != vaultFormat {
		// From a later version of the app, not damaged: left as it is
		return nil, fmt.Errorf("wallet: unsupported vault version %d", v.Version)
	}
	if v.Key == nil && v.Check == nil {
		return nil, errVaultDamaged
	}
	return &v, nil
}

func (w *Wallet) saveVault(v *vaultFile) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := keepPrevious(w.vaultPath(), func(old []byte) bool {
		var prev vaultFile
		return json.Unmarshal(old, &prev) == nil && prev.Version == vaultFormat && prev.Key != nil
	}); err != nil {
		return err
	}
	return writePrivateFile(w.vaultPath(), data)
}

// saveVaultOnly writes the vault and drops its previous version: for every
// change that mustn't leave the vault as it was behind (a new password, a
// phrase removed, the format changed).
func (w *Wallet) saveVaultOnly(v *vaultFile) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := writePrivateFile(w.vaultPath(), data); err != nil {
		return err
	}
	if err := os.Remove(previousCopy(w.vaultPath())); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func encrypt(data []byte, password string) (keystore.CryptoJSON, error) {
	return keystore.EncryptDataV3(data, []byte(password), walletScryptN, walletScryptP)
}

func decrypt(c keystore.CryptoJSON, password string) ([]byte, error) {
	data, err := keystore.DecryptDataV3(c, password)
	if errors.Is(err, keystore.ErrDecrypt) {
		return nil, ErrWrongPassword
	}
	return data, err
}

// newVault makes a vault whose wallet key, wkey, opens with password,
// with the logs' key pair as given (the private half sealed under wkey).
func newVault(password string, wkey, logPublic, logPrivate []byte) (*vaultFile, error) {
	enc, err := encrypt(wkey, password)
	if err != nil {
		return nil, err
	}
	return &vaultFile{Version: vaultFormat, Key: &enc, LogPublic: logPublic, LogPrivate: logPrivate, Seeds: []vaultSeed{}}, nil
}

// newWalletKeys makes a wallet key, and a key pair for the logs whose
// private half is sealed under it. The caller wipes wkey.
func newWalletKeys() (wkey, logPublic, logPrivate []byte, err error) {
	wkey = make([]byte, walletKeyLen)
	if _, err := rand.Read(wkey); err != nil {
		return nil, nil, nil, err
	}
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		clear(wkey)
		return nil, nil, nil, err
	}
	logPrivate, err = sealWith(wkey, sealedLogKey, priv[:])
	clear(priv[:])
	if err != nil {
		clear(wkey)
		return nil, nil, nil, err
	}
	return wkey, pub[:], logPrivate, nil
}

// upgradeVault gives a vault of format 1 its wallet key, once password
// proves to be its own, and saves it as format 2. Its phrases'
// fingerprints stay in it until the labels take them (open). The caller
// holds w.keyMu.
func (w *Wallet) upgradeVault(v *vaultFile, password string) (*vaultFile, error) {
	wkey, logPublic, logPrivate, err := newWalletKeys()
	if err != nil {
		return nil, err
	}
	defer clear(wkey)
	next, err := newVault(password, wkey, logPublic, logPrivate)
	if err != nil {
		return nil, err
	}
	next.Seeds = v.Seeds
	if err := w.saveVaultOnly(next); err != nil {
		return nil, err
	}
	logging.Info("Upgraded the wallet's vault: everything beside the keys is sealed from now on")
	return next, nil
}

// verifyPassword opens v's check with password.
func verifyPassword(v *vaultFile, password string) error {
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	proof := v.Key
	if proof == nil {
		proof = v.Check
	}
	if proof == nil {
		return ErrWrongPassword
	}
	check, err := decrypt(*proof, password)
	if err != nil {
		return err
	}
	clear(check)
	return nil
}

// noVaultError is why a wallet without a vault can't open: it has keys
// from before passwords (to set one that opens them), or nothing yet.
func (w *Wallet) noVaultError() error {
	if len(w.keys().Accounts()) > 0 {
		return ErrNeedsSetup
	}
	return ErrNoPassword
}

// unlockVault returns the vault once password proves to be the wallet's.
// The wallet password is set first, by SetupPassword, before any account
// is made or imported. The caller holds w.keyMu.
func (w *Wallet) unlockVault(password string) (*vaultFile, error) {
	v, err := w.loadVault()
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, w.noVaultError()
	}
	if err := verifyPassword(v, password); err != nil {
		return nil, err
	}
	return v, nil
}

// SetupPassword sets the wallet password, the first step before any
// account is made or imported. A wallet that already has keys but no
// password (made by an earlier build, or keys dropped into the keystore)
// takes one that opens every key already there.
func (w *Wallet) SetupPassword(password string) error {
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	if v, err := w.loadVault(); err != nil {
		return err
	} else if v != nil {
		return errors.New("wallet: the wallet already has a password")
	}
	if err := checkPassword(password); err != nil {
		return err
	}
	for _, acc := range w.keys().Accounts() {
		if err := openKeyFile(acc, password); err != nil {
			return ErrSetupMismatch
		}
	}
	wkey, logPublic, logPrivate, err := newWalletKeys()
	if err != nil {
		return err
	}
	defer clear(wkey)
	v, err := newVault(password, wkey, logPublic, logPrivate)
	if err != nil {
		return err
	}
	if err := w.saveVaultOnly(v); err != nil {
		return err
	}
	logging.Info("Set the wallet password")
	// The password just chosen opens the wallet; short of protected memory
	// it stays locked, for the lock screen to open
	if err := w.keep(password, wkey); err != nil {
		logging.Warn("Failed to unlock the wallet", "err", err)
		return nil
	}
	if err := w.open(password); err != nil {
		logging.Warn("Failed to open the wallet", "err", err)
		w.Lock()
		return nil
	}
	w.announce()
	return nil
}

// openKeyFile checks that password decrypts acc's key file.
func openKeyFile(acc wallet.Account, password string) error {
	data, err := os.ReadFile(acc.URL.Path)
	if err != nil {
		return err
	}
	key, err := keystore.DecryptKey(data, password)
	if key != nil && key.PrivateKey != nil {
		zeroPrivateKey(key.PrivateKey)
	}
	if errors.Is(err, keystore.ErrDecrypt) {
		return ErrWrongPassword
	}
	return err
}

// keyError tells apart, after a key failed to decrypt with password,
// whether password is wrong or right for the wallet but not for this key
// (one dropped into the keystore from elsewhere). The caller holds
// w.keyMu.
func (w *Wallet) keyError(password string) error {
	v, err := w.loadVault()
	if err != nil || v == nil {
		return ErrWrongPassword
	}
	if verifyPassword(v, password) == nil {
		return ErrKeyMismatch
	}
	return ErrWrongPassword
}

// ChangePassword encrypts every key and every recovery phrase of the
// wallet again under a new password. Everything is decrypted with the old
// password first, and nothing changes if any of it fails to open. The new
// files are all written aside before any replaces an old one.
func (w *Wallet) ChangePassword(oldPassword, newPassword string) error {
	if err := w.requireOpen(); err != nil {
		return err
	}
	if err := checkPassword(newPassword); err != nil {
		return err
	}
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	v, err := w.loadVault()
	if err != nil {
		return err
	}
	if v == nil {
		return ErrNoPassword
	}
	if v.Key == nil {
		// Unlocked, the vault has its wallet key: this is one that hasn't been
		return ErrLocked
	}
	wkey, err := decrypt(*v.Key, oldPassword)
	if err != nil {
		return err
	}
	defer clear(wkey)

	// The keys, re-encrypted beside the originals (the keystore ignores
	// hidden files)
	type staged struct{ tmp, path string }
	var files []staged
	defer func() {
		for _, f := range files {
			os.Remove(f.tmp)
		}
	}()
	for _, acc := range w.keys().Accounts() {
		data, err := os.ReadFile(acc.URL.Path)
		if err != nil {
			return err
		}
		key, err := keystore.DecryptKey(data, oldPassword)
		if errors.Is(err, keystore.ErrDecrypt) {
			return fmt.Errorf("%w: %s", ErrKeyMismatch, acc.Address.Hex())
		}
		if err != nil {
			return err
		}
		out, err := keystore.EncryptKey(key, newPassword, walletScryptN, walletScryptP)
		zeroPrivateKey(key.PrivateKey)
		if err != nil {
			return err
		}
		tmp := filepath.Join(filepath.Dir(acc.URL.Path), "."+filepath.Base(acc.URL.Path)+".new")
		if err := os.WriteFile(tmp, out, 0o600); err != nil {
			return err
		}
		files = append(files, staged{tmp, acc.URL.Path})
	}

	// The vault: the same wallet key, and each phrase, under the new password
	next, err := newVault(newPassword, wkey, v.LogPublic, v.LogPrivate)
	if err != nil {
		return err
	}
	for _, s := range v.Seeds {
		entropy, passphrase, err := openSeed(s, oldPassword)
		if err != nil {
			return err
		}
		ns := vaultSeed{ID: s.ID, Fingerprint: s.Fingerprint}
		ns.Entropy, err = encrypt(entropy, newPassword)
		if err == nil && passphrase != nil {
			var p keystore.CryptoJSON
			p, err = encrypt(passphrase, newPassword)
			ns.Passphrase = &p
		}
		clear(entropy)
		clear(passphrase)
		if err != nil {
			return err
		}
		next.Seeds = append(next.Seeds, ns)
	}

	// Everything is ready: swap the new files in
	for _, f := range files {
		if err := os.Rename(f.tmp, f.path); err != nil {
			return fmt.Errorf("wallet: changing the password failed partway: %w", err)
		}
	}
	files = nil
	if err := w.saveVaultOnly(next); err != nil {
		return fmt.Errorf("wallet: changing the password failed partway: %w", err)
	}
	logging.Info("Changed the wallet password")
	// The session keeps the new one from here
	if err := w.keep(newPassword, wkey); err != nil {
		logging.Warn("Failed to unlock the wallet", "err", err)
	}
	return nil
}

// newSeedID names a recovery phrase in the vault.
func newSeedID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// openSeed decrypts a phrase's entropy and passphrase (nil if it has none).
// The caller clears both.
func openSeed(s vaultSeed, password string) (entropy, passphrase []byte, err error) {
	entropy, err = decrypt(s.Entropy, password)
	if err != nil {
		return nil, nil, err
	}
	switch len(entropy) * 8 {
	case 128, 160, 192, 224, 256:
	default:
		clear(entropy)
		return nil, nil, errors.New("wallet: a recovery phrase in the vault is damaged")
	}
	if s.Passphrase != nil {
		if passphrase, err = decrypt(*s.Passphrase, password); err != nil {
			clear(entropy)
			return nil, nil, err
		}
	}
	return entropy, passphrase, nil
}
