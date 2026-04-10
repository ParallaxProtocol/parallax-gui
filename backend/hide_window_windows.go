// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"os/exec"
	"syscall"
)

// createNoWindow is the Windows CREATE_NO_WINDOW process creation flag. It
// prevents the OS from allocating a console window for a console child
// process spawned from a GUI parent (hashwarp is a console app, and without
// this flag Windows pops a stray terminal that, if closed by the user, also
// kills the child).
const createNoWindow = 0x08000000

// hideChildWindow configures cmd so that Windows does not allocate a console
// window for the child process.
func hideChildWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
