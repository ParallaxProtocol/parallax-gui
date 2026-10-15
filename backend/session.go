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
	// idle is how long the wallet stays unlocked with nothing done, 0 for
	// as long as the app runs; gen tells the timer of the latest activity
	// from those it replaced
	idle  time.Duration
	timer *time.Timer
	gen   uint64
	// emit tells the app the wallet locked or unlocked
	emit func(locked bool)
}

// Unlock opens the wallet with its password, for WithPassword to draw on.
func (w *Wallet) Unlock(password string) error {
	w.keyMu.Lock()
	_, err := w.unlockVault(password)
	w.keyMu.Unlock()
	if err != nil {
		return err
	}
	return w.keep(password)
}

// Lock forgets the wallet password, until the next Unlock.
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

// keep seals password as the one the session keeps, unlocking the wallet
// if it wasn't, under a new key if it was.
func (w *Wallet) keep(password string) error {
	key := memguard.NewBufferRandom(sessionKeyLen)
	if key.Size() != sessionKeyLen {
		return errors.New("wallet: no protected memory to unlock the wallet in")
	}
	key.Freeze()
	var nonce [24]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		key.Destroy()
		return err
	}
	plain := []byte(password)
	sealed := secretbox.Seal(nonce[:], plain, &nonce, (*[sessionKeyLen]byte)(key.Bytes()))
	clear(plain)

	s := &w.sess
	s.mu.Lock()
	was := s.key != nil
	s.dropLocked()
	s.key, s.sealed = key, sealed
	s.resetLocked()
	emit := s.emit
	s.mu.Unlock()
	if !was && emit != nil {
		emit(false)
	}
	return nil
}

// lockLocked locks the wallet. The caller holds s.mu, and calls what it
// returns once it has released it, to tell the app.
func (s *session) lockLocked() (notify func()) {
	was := s.key != nil
	s.dropLocked()
	if emit := s.emit; was && emit != nil {
		return func() { emit(true) }
	}
	return func() {}
}

// dropLocked destroys the session's key and wipes the sealed password.
// The caller holds s.mu.
func (s *session) dropLocked() {
	if s.key != nil {
		s.key.Destroy()
		s.key = nil
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
	if s.key == nil || s.idle <= 0 {
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
