// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"golang.org/x/crypto/chacha20poly1305"
)

// Everything the wallet keeps on disk beside its keys is sealed: the
// account names and groupings, the watch-only accounts, the signing
// requests and what was signed, the sends still waiting for a block, and
// the contacts. None of it can be read, or changed unnoticed, without the
// wallet password.
//
// The password opens the wallet key, 32 random bytes kept in the vault
// encrypted under the password (scrypt and AES-128-CTR, as every key is):
// unlocking decrypts it once and the session holds it in protected memory
// until the wallet locks (session.go). Each file is sealed under it with
// XChaCha20-Poly1305 and a fresh random nonce, its name bound in as
// associated data, so one sealed file can't be passed off as another.
// Changing the password encrypts only the wallet key again.
//
// The keys themselves stay standard keystore files, which name their
// account's address in the clear.

// sealMagic starts every sealed file, and its format version.
var sealMagic = []byte("PXSEAL1\n")

// walletKeyLen is the wallet key's length: XChaCha20-Poly1305's.
const walletKeyLen = chacha20poly1305.KeySize

// The sealed files' names, which are also what each is bound to.
const (
	sealedMeta     = "wallet.sealed"
	sealedRequests = "requests.sealed"
	sealedSigned   = "signed.sealed"
	sealedPending  = "pending.sealed"
	sealedContacts = "contacts.sealed"
	sealedLogKey   = "log-key"
)

var errSealed = errors.New("wallet: a sealed file is damaged or isn't this wallet's")

// sealWith seals plain under key, bound to name.
func sealWith(key []byte, name string, plain []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	out := make([]byte, len(sealMagic)+aead.NonceSize(), len(sealMagic)+aead.NonceSize()+len(plain)+aead.Overhead())
	copy(out, sealMagic)
	nonce := out[len(sealMagic):]
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(out, nonce, plain, []byte("parallax-wallet/"+name)), nil
}

// openWith opens what sealWith sealed under key, bound to name.
func openWith(key []byte, name string, sealed []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	if len(sealed) < len(sealMagic)+aead.NonceSize()+aead.Overhead() || !bytes.HasPrefix(sealed, sealMagic) {
		return nil, errSealed
	}
	nonce := sealed[len(sealMagic) : len(sealMagic)+aead.NonceSize()]
	plain, err := aead.Open(nil, nonce, sealed[len(sealMagic)+aead.NonceSize():], []byte("parallax-wallet/"+name))
	if err != nil {
		return nil, errSealed
	}
	return plain, nil
}

// Sealer seals and opens files under the wallet key, while the wallet is
// unlocked; ErrLocked otherwise. The contacts keep their book through it.
type Sealer interface {
	// WriteSealed seals v, as JSON, into the file at path, bound to name.
	WriteSealed(path, name string, v any) error
	// ReadSealed opens the file at path, bound to name, into v; false when
	// there is no such file.
	ReadSealed(path, name string, v any) (bool, error)
}

// WriteSealed seals v into path under the wallet key.
func (w *Wallet) WriteSealed(path, name string, v any) error {
	plain, err := json.Marshal(v)
	if err != nil {
		return err
	}
	defer clear(plain)
	return w.withWalletKey(func(key []byte) error {
		sealed, err := sealWith(key, name, plain)
		if err != nil {
			return err
		}
		if err := keepPrevious(path, func(data []byte) bool {
			old, err := openWith(key, name, data)
			clear(old)
			return err == nil
		}); err != nil {
			return err
		}
		return writePrivateFile(path, sealed)
	})
}

// ReadSealed opens path under the wallet key into v.
func (w *Wallet) ReadSealed(path, name string, v any) (bool, error) {
	sealed, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var plain []byte
	if err := w.withWalletKey(func(key []byte) error {
		plain, err = openWith(key, name, sealed)
		return err
	}); err != nil {
		return false, err
	}
	defer clear(plain)
	if err := json.Unmarshal(plain, v); err != nil {
		return false, fmt.Errorf("%w: %v", errSealed, err)
	}
	return true, nil
}

// migratePlain moves a file an earlier version kept in the clear into its
// sealed form: read from legacy, sealed into path, and the clear copy
// removed. Nothing happens when there is no clear copy; when both are
// there (the move was cut short after sealing), the sealed one stands.
// The clear file's contents may linger on the disk where it was, as any
// deleted file's do, until written over.
func (w *Wallet) migratePlain(legacy, path, name string, v any) error {
	data, err := os.ReadFile(legacy)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer clear(data)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := json.Unmarshal(data, v); err != nil {
			// Unreadable already: set aside, as a damaged sealed one is
			setAside(legacy)
			return nil
		}
		if err := w.WriteSealed(path, name, v); err != nil {
			return err
		}
	}
	return os.Remove(legacy)
}

// LogPublicKey is the key the logs are sealed to; nil while the wallet
// has no password (or a vault of format 1, until it's first unlocked).
// Nothing secret: it only seals.
func (w *Wallet) LogPublicKey() []byte {
	v, err := w.loadVault()
	if err != nil || v == nil || len(v.LogPublic) != 32 {
		return nil
	}
	return v.LogPublic
}

// OpenLogs reads back into logs the lines earlier runs sealed, with the
// logs' private key, opened under the wallet key for the moment it takes.
func (w *Wallet) OpenLogs(logs *LogTail) error {
	v, err := w.loadVault()
	if err != nil {
		return err
	}
	if v == nil || len(v.LogPublic) != 32 || len(v.LogPrivate) == 0 {
		return nil
	}
	var pub, priv [32]byte
	copy(pub[:], v.LogPublic)
	defer clear(priv[:])
	if err := w.withWalletKey(func(key []byte) error {
		p, err := openWith(key, sealedLogKey, v.LogPrivate)
		if err != nil {
			return err
		}
		defer clear(p)
		if len(p) != 32 {
			return errSealed
		}
		copy(priv[:], p)
		return nil
	}); err != nil {
		return err
	}
	logs.Unseal(&pub, &priv)
	return nil
}

// A sealed file keeps its previous version beside it (path.1), written
// over only by one that opened: should the file be damaged (the disk
// failing, or it changed by someone else; the cipher can't tell which),
// the wallet falls back to the last version it could open, at worst a
// change behind. One that won't open either way is set aside
// (path.damaged-<time>, kept for recovery by hand) and the wallet goes on
// without it, so a damaged file never keeps the wallet from unlocking: the
// keys and the phrases aren't in these files.

// previousCopy is where path's previous version is kept.
func previousCopy(path string) string { return path + ".1" }

// keepPrevious moves the file at path aside as its previous version, when
// good says it's sound; one that isn't leaves the previous version be.
func keepPrevious(path string, good func(data []byte) bool) error {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !good(data) {
		return nil
	}
	return os.Rename(path, previousCopy(path))
}

// setAside moves a damaged file out of the way, for recovery by hand.
func setAside(path string) {
	aside := fmt.Sprintf("%s.damaged-%d", path, time.Now().Unix())
	if err := os.Rename(path, aside); err != nil && !os.IsNotExist(err) {
		logging.Warn("Failed to set aside a damaged wallet file", "file", filepath.Base(path), "err", err)
		return
	}
	logging.Warn("Set aside a damaged wallet file", "file", filepath.Base(path), "aside", filepath.Base(aside))
}

// readSealedOrRecover opens the sealed file at path into v, else its
// previous version; with neither, the file is set aside and v left empty.
// damaged is set when the file itself didn't open. ErrLocked, and a file
// that can't be read at all, are the only errors.
func (w *Wallet) readSealedOrRecover(path, name string, v any) (damaged bool, err error) {
	ok, err := w.ReadSealed(path, name, v)
	switch {
	case err == nil && ok:
		return false, nil
	case errors.Is(err, ErrLocked):
		return false, err
	case err != nil && !errors.Is(err, errSealed):
		return false, err
	}
	// Missing (a write cut short between its two renames), or damaged: what
	// a damaged one half filled in goes, before the previous version's
	rv := reflect.ValueOf(v).Elem()
	rv.Set(reflect.Zero(rv.Type()))
	if ok, perr := w.ReadSealed(previousCopy(path), name, v); perr == nil && ok {
		if err != nil {
			setAside(path)
			return true, nil
		}
		return false, nil
	}
	if err != nil {
		setAside(path)
		return true, nil
	}
	return false, nil
}

// noteDamaged records that the store named store was damaged as the
// wallet opened, for the app to tell (Info).
func (w *Wallet) noteDamaged(store string) {
	w.damagedMu.Lock()
	defer w.damagedMu.Unlock()
	for _, s := range w.damaged {
		if s == store {
			return
		}
	}
	w.damaged = append(w.damaged, store)
}

// damagedStores is what noteDamaged recorded; never nil.
func (w *Wallet) damagedStores() []string {
	w.damagedMu.Lock()
	defer w.damagedMu.Unlock()
	return append([]string{}, w.damaged...)
}

// DismissDamaged forgets what was found damaged, once the app has told
// the user.
func (w *Wallet) DismissDamaged() {
	w.damagedMu.Lock()
	defer w.damagedMu.Unlock()
	w.damaged = nil
}
