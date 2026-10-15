// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

// lockEvents records what the wallet tells the app as it locks and unlocks.
type lockEvents struct {
	mu  sync.Mutex
	got []bool
}

func (e *lockEvents) emit(locked bool) {
	e.mu.Lock()
	e.got = append(e.got, locked)
	e.mu.Unlock()
}

func (e *lockEvents) list() []bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]bool(nil), e.got...)
}

func usePassword(w *Wallet) (string, error) {
	var got string
	err := w.WithPassword(func(p string) error { got = p; return nil })
	return got, err
}

func TestSessionUnlockLock(t *testing.T) {
	w, _ := newBareWallet(t)
	var events lockEvents
	w.SetLockEmitter(events.emit)

	// Setting the password unlocks the wallet with it
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	if p, err := usePassword(w); err != nil || p != testPassword {
		t.Fatalf("after setup: %q, %v", p, err)
	}
	if info := w.Info(); info.Locked {
		t.Fatal("Info says locked while unlocked")
	}

	w.Lock()
	if _, err := usePassword(w); !errors.Is(err, ErrLocked) {
		t.Fatalf("after Lock: %v, want ErrLocked", err)
	}
	if info := w.Info(); !info.Locked {
		t.Fatal("Info says unlocked while locked")
	}
	w.Lock() // already locked: nothing to tell

	if err := w.Unlock("not the password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	if w.Unlocked() {
		t.Fatal("a wrong password unlocked the wallet")
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	if p, err := usePassword(w); err != nil || p != testPassword {
		t.Fatalf("after Unlock: %q, %v", p, err)
	}

	// A new password replaces the one kept, the wallet staying unlocked
	const next = "a different password"
	if err := w.ChangePassword(testPassword, next); err != nil {
		t.Fatal(err)
	}
	if p, err := usePassword(w); err != nil || p != next {
		t.Fatalf("after ChangePassword: %q, %v", p, err)
	}

	if got, want := events.list(), []bool{false, true, false}; !slices.Equal(got, want) {
		t.Fatalf("events %v, want %v", got, want)
	}
}

func TestSessionNeedsPassword(t *testing.T) {
	w, _ := newBareWallet(t)
	if err := w.Unlock(testPassword); !errors.Is(err, ErrNoPassword) {
		t.Fatalf("Unlock with no password set: %v", err)
	}
	if info := w.Info(); info.Locked {
		t.Fatal("a wallet with no password counts as locked")
	}
}

func TestSessionAutoLock(t *testing.T) {
	w, _ := newTestWallet(t)
	var events lockEvents
	w.SetLockEmitter(events.emit)
	w.SetAutoLock(150 * time.Millisecond)

	// Activity puts the lock off
	for range 4 {
		time.Sleep(60 * time.Millisecond)
		w.Touch()
	}
	if !w.Unlocked() {
		t.Fatal("locked despite activity")
	}
	time.Sleep(60 * time.Millisecond)
	if _, err := usePassword(w); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for w.Unlocked() {
		if time.Now().After(deadline) {
			t.Fatal("never locked")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := events.list(); !slices.Equal(got, []bool{true}) {
		t.Fatalf("events %v, want [true]", got)
	}

	// 0: unlocked for as long as the app runs
	w.SetAutoLock(0)
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if !w.Unlocked() {
		t.Fatal("locked with no auto-lock")
	}
}

func TestAutoLockConfig(t *testing.T) {
	for minutes, want := range map[int]time.Duration{0: DefaultAutoLock, -1: 0, 5: 5 * time.Minute} {
		if got := (GUIConfig{AutoLockMinutes: minutes}).AutoLock(); got != want {
			t.Errorf("AutoLockMinutes %d: %v, want %v", minutes, got, want)
		}
	}
}
