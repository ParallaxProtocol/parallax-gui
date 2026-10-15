// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

// HardenProcess does nothing on Windows. It has no core dumps to turn off,
// and nothing like Linux's non-dumpable flag: a process's owner can always
// rewrite its access list, so denying memory reads in it would stop no
// process running as the same user.
func HardenProcess() error { return nil }

// processDiskBytes reads nothing here: the daemon's disk metrics stand.
func processDiskBytes() (read, written uint64, ok bool) { return 0, 0, false }
