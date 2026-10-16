// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !linux

package backend

import "errors"

// usbSetupNeeded is false off Linux: macOS and Windows give the user at
// the computer USB devices without anything installed.
func usbSetupNeeded() bool { return false }

// HardwareSetupUSB has nothing to set up off Linux.
func (w *Wallet) HardwareSetupUSB() error {
	return errors.New("hardware: there is no USB access to set up on this system")
}
