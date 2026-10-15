// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

// After HardenProcess the process is non-dumpable, writes no core, and
// still counts its own disk traffic.
func TestHardenProcess(t *testing.T) {
	if err := HardenProcess(); err != nil {
		t.Fatal(err)
	}
	if d, err := unix.PrctlRetInt(unix.PR_GET_DUMPABLE, 0, 0, 0, 0); err != nil || d != 0 {
		t.Fatalf("dumpable = %d (%v), want 0", d, err)
	}
	var lim unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_CORE, &lim); err != nil || lim.Cur != 0 {
		t.Fatalf("core limit = %d (%v), want 0", lim.Cur, err)
	}

	_, before, ok := processDiskBytes()
	if !ok {
		t.Fatal("disk counters unreadable")
	}
	if err := os.WriteFile(filepath.Join(t.TempDir(), "f"), make([]byte, 1<<16), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, after, ok := processDiskBytes(); !ok || after < before+1<<16 {
		t.Fatalf("written %d → %d (ok %v), want at least 64 KiB more", before, after, ok)
	}
}
