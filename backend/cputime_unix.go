// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !windows

package backend

import "golang.org/x/sys/unix"

// processCPUSeconds is the CPU time this process has used, user and system
// together, since it started, to the microsecond.
func processCPUSeconds() (float64, bool) {
	var ru unix.Rusage
	if err := unix.Getrusage(unix.RUSAGE_SELF, &ru); err != nil {
		return 0, false
	}
	sec := func(tv unix.Timeval) float64 { return float64(tv.Sec) + float64(tv.Usec)/1e6 }
	return sec(ru.Utime) + sec(ru.Stime), true
}
