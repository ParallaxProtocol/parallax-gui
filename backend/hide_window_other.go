// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !windows

package backend

import "os/exec"

// hideChildWindow is a no-op on non-Windows platforms.
func hideChildWindow(cmd *exec.Cmd) {}
