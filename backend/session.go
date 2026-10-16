// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/rand"
	"errors"
	"sync"
	"time"

	"github.com/awnumar/memguard"
	"golang.org/x/crypto/nacl/secretbox"
)

// The wallet unlocks once, as MetaMask does: Unlock checks the wallet
// password and keeps it for the actions that sign or add keys to draw on
// (WithPassword), until Lock locks the wallet again: from the app, after
// the time it is left idle (SetAutoLock), when the system sleeps or its
// screen locks (the shell, desktop/src/main.ts), and as the app quits.
// Revealing a phrase, saving a backup, removing keys, changing the
// password and approving what an assistant asks still take the password
// typed.
//
// The password is kept sealed (XSalsa20-Poly1305) under a key of its own,
// made at random for each unlock and held by memguard: in memory locked
// out of swap and core dumps, read-only, between guard pages. Locking
// destroys the key, which leaves nothing that could open the sealed copy,
// and wipes that too. A key only ever decrypts for the one action asking,
// as before.
//
// The wallet key (sealed.go), which opens everything the wallet keeps
// beside its keys, is held the same way while unlocked, and destroyed as
// the wallet locks; what it opened (the account names, the contacts) is
// forgotten with it.

var ErrLocked = errors.New("wallet: the wallet is locked")

// DefaultAutoLock is how long the wallet stays unlocked with nothing done
// in the app, unless the user picked otherwise.
const DefaultAutoLock = 15 * time.Minute

const sessionKeyLen = 32

type session struct {
	mu sync.Mutex
	// key seals the password while unlocked; nil while locked
	key    *memguard.LockedBuffer
	sealed []byte // nonce, then the sealed password
	// wkey is the wallet key while unlocked; nil while locked
	wkey *memguard.LockedBuffer
	// forget drops what the wallet key opened, as the wallet locks
	forget func()
	// idle is how long the wallet stays unlocked with nothing done, 0 for
	// as long as the app runs; gen tells the timer of the latest activity
	// from those it replaced
	idle  time.Duration
	timer *time.Timer
	gen   uint64
	// holds counts what keeps the auto-lock off while it runs (Hold): the
	// idle time starts once the last ends
	holds int
	// emit tells the app the wallet locked or unlocked
	emit func(locked bool)
}

// Unlock opens the wallet with its password, for WithPassword to draw on.
func (w *Wallet) Unlock(password string) error {
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	v, err := w.loadVault()
	if err != nil {
		return err
	}
	if v == nil {
		return w.noVaultError()
	}
	// An earlier version's vault gets its wallet key now (sealed.go)
	if v.Key == nil {
		if err := verifyPassword(v, password); err != nil {
			return err
		}
		if v, err = w.upgradeVault(v, password); err != nil {
			return err
		}
	}
	// Decrypting the wallet key is what proves the password
	wkey, err := decrypt(*v.Key, password)
	if err != nil {
		return err
	}
	defer clear(wkey)
	if err := w.keep(password, wkey); err != nil {
		return err
	}
	if err := w.open(password); err != nil {
		w.Lock()
		return err
	}
	w.announce()
	return nil
}

// Lock forgets the wallet password and the wallet key, and what the key
// opened, until the next Unlock.
func (w *Wallet) Lock() {
	w.sess.mu.Lock()
	notify := w.sess.lockLocked()
	w.sess.mu.Unlock()
	notify()
}

// Unlocked reports whether the wallet password is kept.
func (w *Wallet) Unlocked() bool {
	w.sess.mu.Lock()
	defer w.sess.mu.Unlock()
	return w.sess.key != nil
}

// withWalletKey runs f with the wallet key, while the wallet is unlocked;
// ErrLocked otherwise. The key is memguard's: f mustn't keep it, and
// mustn't call into the session, which is held while it runs.
func (w *Wallet) withWalletKey(f func(key []byte) error) error {
	s := &w.sess
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wkey == nil {
		return ErrLocked
	}
	return f(s.wkey.Bytes())
}

// WithPassword runs f with the wallet password, while the wallet is
// unlocked; ErrLocked otherwise. It counts as activity.
func (w *Wallet) WithPassword(f func(password string) error) error {
	s := &w.sess
	s.mu.Lock()
	if s.key == nil {
		s.mu.Unlock()
		return ErrLocked
	}
	// Opened into memguard's memory, then copied out for the keystore,
	// which takes a string; the bridge's erasing wipes that copy
	// (secret_erase.go, at the repository root)
	size := len(s.sealed) - 24 - secretbox.Overhead
	buf := memguard.NewBuffer(size)
	var password string
	// Short of protected memory, Open would decrypt onto the heap instead
	if buf.Size() == size {
		nonce := (*[24]byte)(s.sealed[:24])
		if _, ok := secretbox.Open(buf.Bytes()[:0], s.sealed[24:], nonce, (*[sessionKeyLen]byte)(s.key.Bytes())); ok {
			password = string(buf.Bytes())
		}
	}
	buf.Destroy()
	if password == "" {
		notify := s.lockLocked()
		s.mu.Unlock()
		notify()
		return ErrLocked
	}
	s.resetLocked()
	s.mu.Unlock()
	return f(password)
}

// Touch tells the wallet the user is at the app, putting off the auto-lock.
func (w *Wallet) Touch() {
	w.sess.mu.Lock()
	defer w.sess.mu.Unlock()
	w.sess.resetLocked()
}

// Hold keeps the wallet from locking itself for being left idle until the
// returned func is called, as an assistant's tool call does while it runs
// (mcp_lock.go); the idle time starts over then. Locking it from the app,
// or as the system sleeps, still locks it.
func (w *Wallet) Hold() (release func()) {
	s := &w.sess
	s.mu.Lock()
	s.holds++
	s.resetLocked()
	s.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			s.holds--
			s.resetLocked()
			s.mu.Unlock()
		})
	}
}

// SetAutoLock sets how long the wallet stays unlocked with nothing done,
// 0 for as long as the app runs.
func (w *Wallet) SetAutoLock(idle time.Duration) {
	w.sess.mu.Lock()
	defer w.sess.mu.Unlock()
	w.sess.idle = idle
	w.sess.resetLocked()
}

// SetLockEmitter registers what is told when the wallet locks or unlocks.
func (w *Wallet) SetLockEmitter(emit func(locked bool)) {
	w.sess.mu.Lock()
	defer w.sess.mu.Unlock()
	w.sess.emit = emit
}

// keep seals password as the one the session keeps, and holds the wallet
// key wkey (copied: the caller wipes its own), unlocking the wallet if it
// wasn't, under a new key if it was.
func (w *Wallet) keep(password string, wkey []byte) error {
	key := memguard.NewBufferRandom(sessionKeyLen)
	if key.Size() != sessionKeyLen {
		return errors.New("wallet: no protected memory to unlock the wallet in")
	}
	key.Freeze()
	held := memguard.NewBuffer(walletKeyLen)
	if held.Size() != walletKeyLen || len(wkey) != walletKeyLen {
		key.Destroy()
		held.Destroy()
		return errors.New("wallet: no protected memory to unlock the wallet in")
	}
	copy(held.Bytes(), wkey)
	held.Freeze()
	var nonce [24]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		key.Destroy()
		held.Destroy()
		return err
	}
	plain := []byte(password)
	sealed := secretbox.Seal(nonce[:], plain, &nonce, (*[sessionKeyLen]byte)(key.Bytes()))
	clear(plain)

	s := &w.sess
	s.mu.Lock()
	s.dropLocked()
	s.key, s.sealed, s.wkey = key, sealed, held
	s.resetLocked()
	s.mu.Unlock()
	return nil
}

// announce tells the app the wallet is unlocked, once what the wallet key
// opens is open.
func (w *Wallet) announce() {
	w.sess.mu.Lock()
	emit := w.sess.emit
	w.sess.mu.Unlock()
	if emit != nil {
		emit(false)
	}
}

// lockLocked locks the wallet. The caller holds s.mu, and calls what it
// returns once it has released it, to tell the app.
func (s *session) lockLocked() (notify func()) {
	was := s.key != nil
	s.dropLocked()
	if !was {
		return func() {}
	}
	forget, emit := s.forget, s.emit
	return func() {
		if forget != nil {
			forget()
		}
		if emit != nil {
			emit(true)
		}
	}
}

// dropLocked destroys the session's key and wipes the sealed password.
// The caller holds s.mu.
func (s *session) dropLocked() {
	if s.key != nil {
		s.key.Destroy()
		s.key = nil
	}
	if s.wkey != nil {
		s.wkey.Destroy()
		s.wkey = nil
	}
	clear(s.sealed)
	s.sealed = nil
	s.gen++
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
}

// resetLocked starts the idle time over, while the wallet is unlocked.
// The caller holds s.mu.
func (s *session) resetLocked() {
	s.gen++
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.key == nil || s.idle <= 0 || s.holds > 0 {
		return
	}
	gen := s.gen
	s.timer = time.AfterFunc(s.idle, func() {
		s.mu.Lock()
		notify := func() {}
		// Unless activity came after this timer was set
		if s.gen == gen {
			notify = s.lockLocked()
		}
		s.mu.Unlock()
		notify()
	})
}
