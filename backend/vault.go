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
)

// The vault is what the wallet keeps secret beside its keystore, in
// vault.json: a check value that proves the wallet password, and the
// recovery phrases, each encrypted with that password by the daemon's
// keystore encryption (scrypt and AES-128-CTR). Every key in the keystore
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

const (
	vaultFileName = "vault.json"
	vaultFormat   = 1
	checkBytes    = 32
)

type vaultFile struct {
	Version int                 `json:"version"`
	Check   keystore.CryptoJSON `json:"check"`
	Seeds   []vaultSeed         `json:"seeds"`
}

// vaultSeed is one recovery phrase: its entropy and, if it has one, its
// BIP-39 passphrase, both encrypted. Fingerprint is the public address of
// its first standard account: it tells phrases apart without decrypting
// them, so the same phrase isn't added twice.
type vaultSeed struct {
	ID          string               `json:"id"`
	Entropy     keystore.CryptoJSON  `json:"entropy"`
	Passphrase  *keystore.CryptoJSON `json:"passphrase,omitempty"`
	Fingerprint string               `json:"fingerprint"`
}

func (w *Wallet) vaultPath() string { return filepath.Join(filepath.Dir(w.metaPath), vaultFileName) }

// loadVault reads the vault; nil when the wallet has none yet.
func (w *Wallet) loadVault() (*vaultFile, error) {
	data, err := os.ReadFile(w.vaultPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var v vaultFile
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, fmt.Errorf("wallet: unreadable vault: %w", err)
	}
	if v.Version != vaultFormat {
		return nil, fmt.Errorf("wallet: unsupported vault version %d", v.Version)
	}
	return &v, nil
}

func (w *Wallet) saveVault(v *vaultFile) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(w.vaultPath(), data)
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

// newVault makes a vault whose check opens with password.
func newVault(password string) (*vaultFile, error) {
	check := make([]byte, checkBytes)
	if _, err := rand.Read(check); err != nil {
		return nil, err
	}
	enc, err := encrypt(check, password)
	clear(check)
	if err != nil {
		return nil, err
	}
	return &vaultFile{Version: vaultFormat, Check: enc, Seeds: []vaultSeed{}}, nil
}

// verifyPassword opens v's check with password.
func verifyPassword(v *vaultFile, password string) error {
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	check, err := decrypt(v.Check, password)
	if err != nil {
		return err
	}
	clear(check)
	return nil
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
		if len(w.ks.Accounts()) > 0 {
			return nil, ErrNeedsSetup
		}
		return nil, ErrNoPassword
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
	for _, acc := range w.ks.Accounts() {
		if err := openKeyFile(acc, password); err != nil {
			return ErrSetupMismatch
		}
	}
	v, err := newVault(password)
	if err != nil {
		return err
	}
	if err := w.saveVault(v); err != nil {
		return err
	}
	logging.Info("Set the wallet password")
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
	if err := verifyPassword(v, oldPassword); err != nil {
		return err
	}

	// The keys, re-encrypted beside the originals (the keystore ignores
	// hidden files)
	type staged struct{ tmp, path string }
	var files []staged
	defer func() {
		for _, f := range files {
			os.Remove(f.tmp)
		}
	}()
	for _, acc := range w.ks.Accounts() {
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

	// The vault: a new check, and each phrase under the new password
	next, err := newVault(newPassword)
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
	if err := w.saveVault(next); err != nil {
		return fmt.Errorf("wallet: changing the password failed partway: %w", err)
	}
	logging.Info("Changed the wallet password")
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
