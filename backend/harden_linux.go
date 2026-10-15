// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

// HardenProcess keeps the backend's memory, where passwords, recovery
// phrases and keys pass while the wallet uses them, from being copied out
// of it: no core dump is written if it crashes, and the process is made
// non-dumpable, so other processes running as the same user can't attach
// to it or read /proc/<pid>/mem even where Yama's ptrace_scope allows it.
// Run first thing, before any secret is in memory.
//
// A non-dumpable process's /proc files belong to root, which shuts the
// daemon's own disk metrics out of /proc/self/io; the file is opened here
// first, and NodeUsage reads it instead (processDiskBytes).
func HardenProcess() error {
	var errs []error
	if err := unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{}); err != nil {
		errs = append(errs, fmt.Errorf("core dump limit: %w", err))
	}
	if f, err := os.Open("/proc/self/io"); err == nil {
		procIO = f
	}
	if err := unix.Prctl(unix.PR_SET_DUMPABLE, 0, 0, 0, 0); err != nil {
		errs = append(errs, fmt.Errorf("non-dumpable: %w", err))
	}
	return errors.Join(errs...)
}

// procIO is /proc/self/io, opened before the process became non-dumpable.
var procIO *os.File

// processDiskBytes is what the process has read and written since it
// started, the counters the daemon's disk metrics follow (rchar and wchar);
// ok is false if they can't be read.
func processDiskBytes() (read, written uint64, ok bool) {
	if procIO == nil {
		return 0, 0, false
	}
	buf := make([]byte, 512)
	n, err := procIO.ReadAt(buf, 0)
	if err != nil && err != io.EOF {
		return 0, 0, false
	}
	var seen int
	for _, line := range bytes.Split(buf[:n], []byte("\n")) {
		key, value, found := bytes.Cut(line, []byte(":"))
		if !found {
			continue
		}
		v, err := strconv.ParseUint(string(bytes.TrimSpace(value)), 10, 64)
		if err != nil {
			continue
		}
		switch string(key) {
		case "rchar":
			read, seen = v, seen+1
		case "wchar":
			written, seen = v, seen+1
		}
	}
	return read, written, seen == 2
}
