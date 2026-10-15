// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/nacl/box"
)

func lines(tail *LogTail) []string {
	var out []string
	for _, l := range tail.Tail(0) {
		out = append(out, l.Message)
	}
	return out
}

func logKeys(t *testing.T) (pub, priv *[32]byte) {
	t.Helper()
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

// persisted starts a tail keeping its logs in dir, sealed to pub.
func persisted(t *testing.T, dir string, clear bool, pub *[32]byte) *LogTail {
	t.Helper()
	tail := NewLogTail(16)
	if err := tail.Persist(dir, clear); err != nil {
		t.Fatal(err)
	}
	if err := tail.SealTo(pub[:]); err != nil {
		t.Fatal(err)
	}
	return tail
}

func TestLogFileSealedAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	pub, priv := logKeys(t)

	// A first run logs two lines, one before the file is set up
	first := NewLogTail(16)
	first.append(LogLine{Message: "early secret 0xabc", Source: "app"})
	if err := first.Persist(dir, false); err != nil {
		t.Fatal(err)
	}
	if err := first.SealTo(pub[:]); err != nil {
		t.Fatal(err)
	}
	first.append(LogLine{Message: "later", Source: "node"})
	first.Close()

	raw, err := os.ReadFile(filepath.Join(dir, logFileName))
	if err != nil || len(raw) == 0 {
		t.Fatalf("log file: %d bytes, %v", len(raw), err)
	}
	if bytes.Contains(raw, []byte("secret")) || bytes.Contains(raw, []byte("later")) {
		t.Fatal("the log file holds a line in the clear")
	}

	// The next run starts without them: they open with the private key
	second := persisted(t, dir, false, pub)
	second.append(LogLine{Message: "now"})
	if got := lines(second); len(got) != 1 || got[0] != "now" {
		t.Fatalf("lines before Unseal = %v, want [now]", got)
	}
	_, wrong := logKeys(t)
	second.Unseal(pub, wrong)
	if got := lines(second); len(got) != 1 {
		t.Fatalf("lines after Unseal with the wrong key = %v, want [now]", got)
	}
	second.file.earlierEnd = int64(len(raw)) // the wrong key spent the one read
	second.Unseal(pub, priv)
	got := lines(second)
	if len(got) != 3 || got[0] != "early secret 0xabc" || got[1] != "later" || got[2] != "now" {
		t.Fatalf("lines after Unseal = %v, want [early later now]", got)
	}
	if got := second.Tail(0)[0].Source; got != "app" {
		t.Fatalf("source kept across the restart = %q, want app", got)
	}
	// Only once: they're this run's lines now
	second.Unseal(pub, priv)
	if got := lines(second); len(got) != 3 {
		t.Fatalf("lines after a second Unseal = %v", got)
	}

	// Clearing empties the tail and the file
	second.Clear()
	second.Close()
	if got := lines(second); len(got) != 0 {
		t.Fatalf("lines after Clear = %v, want none", got)
	}
	if got := readSealedLogFile(filepath.Join(dir, logFileName), 1<<20, pub, priv); len(got) != 0 {
		t.Fatalf("file after Clear holds %d lines, want none", len(got))
	}

	// Clearing on startup starts afresh
	third := persisted(t, dir, false, pub)
	third.append(LogLine{Message: "kept"})
	third.Close()
	fourth := persisted(t, dir, true, pub)
	fourth.Unseal(pub, priv)
	if got := lines(fourth); len(got) != 0 {
		t.Fatalf("lines with clear on startup = %v, want none", got)
	}
}

func TestLogFileSealsAnEarlierVersionsPlainLog(t *testing.T) {
	dir := t.TempDir()
	pub, priv := logKeys(t)
	plain, _ := json.Marshal(LogLine{Message: "Sent a wallet transaction", Source: "app"})
	writeFile(t, filepath.Join(dir, legacyLogFile), string(plain)+"\n")

	tail := persisted(t, dir, false, pub)
	tail.Close()
	if _, err := os.Stat(filepath.Join(dir, legacyLogFile)); !os.IsNotExist(err) {
		t.Fatalf("the clear log is still there: %v", err)
	}
	next := persisted(t, dir, false, pub)
	next.Unseal(pub, priv)
	if got := lines(next); len(got) != 1 || got[0] != "Sent a wallet transaction" {
		t.Fatalf("lines = %v, want the earlier version's", got)
	}
}

func TestLogFileWithoutAKeyStaysInMemory(t *testing.T) {
	dir := t.TempDir()
	plain, _ := json.Marshal(LogLine{Message: "old"})
	writeFile(t, filepath.Join(dir, legacyLogFile), string(plain)+"\n")
	tail := NewLogTail(16)
	if err := tail.Persist(dir, false); err != nil {
		t.Fatal(err)
	}
	tail.DropPlain()
	tail.append(LogLine{Message: "new"})
	tail.Close()
	if got := lines(tail); len(got) != 2 || got[0] != "old" {
		t.Fatalf("lines = %v, want [old new]", got)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("files written without a key: %v", entries)
	}
}
