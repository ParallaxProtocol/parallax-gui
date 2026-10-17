// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"os"
	"os/exec"
	"syscall"
)

// prepareTorCmd keeps Tor, a console program, from opening a window.
func prepareTorCmd(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// stopTor ends Tor: Windows has no signal to ask it to, and a client has
// nothing to finish.
func stopTor(p *os.Process, exited <-chan struct{}) {
	_ = p.Kill()
}
