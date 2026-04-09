// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !windows

package backend

// addDefenderExclusion is a no-op on non-Windows platforms.
func addDefenderExclusion(_ string) error {
	return nil
}
