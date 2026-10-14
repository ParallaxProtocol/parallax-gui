// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func lines(tail *LogTail) []string {
	var out []string
	for _, l := range tail.Tail(0) {
		out = append(out, l.Message)
	}
	return out
}

func TestLogFileAcrossRestarts(t *testing.T) {
	dir := t.TempDir()

	// A first run logs two lines, one before the file is set up
	first := NewLogTail(16)
	first.append(LogLine{Message: "early", Source: "app"})
	if err := first.Persist(dir, false); err != nil {
		t.Fatal(err)
	}
	first.append(LogLine{Message: "later", Source: "node"})
	first.Close()

	// The next run starts with them, before its own
	second := NewLogTail(16)
	second.append(LogLine{Message: "now"})
	if err := second.Persist(dir, false); err != nil {
		t.Fatal(err)
	}
	if got := lines(second); len(got) != 3 || got[0] != "early" || got[1] != "later" || got[2] != "now" {
		t.Fatalf("lines after a restart = %v, want [early later now]", got)
	}
	if got := second.Tail(0)[0].Source; got != "app" {
		t.Fatalf("source kept across the restart = %q, want app", got)
	}

	// Clearing empties the tail and the file
	second.Clear()
	second.Close()
	if got := lines(second); len(got) != 0 {
		t.Fatalf("lines after Clear = %v, want none", got)
	}
	if got := readLogFile(filepath.Join(dir, logFileName)); len(got) != 0 {
		t.Fatalf("file after Clear holds %d lines, want none", len(got))
	}

	// Clearing on startup starts afresh
	third := NewLogTail(16)
	third.append(LogLine{Message: "kept"})
	if err := third.Persist(dir, false); err != nil {
		t.Fatal(err)
	}
	third.Close()
	fourth := NewLogTail(16)
	if err := fourth.Persist(dir, true); err != nil {
		t.Fatal(err)
	}
	if got := lines(fourth); len(got) != 0 {
		t.Fatalf("lines with clear on startup = %v, want none", got)
	}
	if info, err := os.Stat(filepath.Join(dir, logFileName)); err != nil || info.Size() != 0 {
		t.Fatalf("file with clear on startup: %v, %v; want empty", info, err)
	}
}
