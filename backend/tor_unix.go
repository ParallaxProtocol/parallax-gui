// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !windows

package backend

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

// prepareTorCmd has nothing to set up for Tor's process here.
func prepareTorCmd(cmd *exec.Cmd) {}

// stopTor asks Tor to exit, as its own signal for a clean exit, and kills
// it if it hasn't within a few seconds; exited closes as it does.
func stopTor(p *os.Process, exited <-chan struct{}) {
	_ = p.Signal(syscall.SIGTERM)
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		_ = p.Kill()
	}
}
