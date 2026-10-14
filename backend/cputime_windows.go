// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build windows

package backend

import "golang.org/x/sys/windows"

// processCPUSeconds is the CPU time this process has used, user and kernel
// together, since it started.
func processCPUSeconds() (float64, bool) {
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(windows.CurrentProcess(), &creation, &exit, &kernel, &user); err != nil {
		return 0, false
	}
	// A Filetime counts 100-nanosecond intervals
	ticks := func(ft windows.Filetime) float64 {
		return float64(uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime))
	}
	return (ticks(kernel) + ticks(user)) / 1e7, true
}
