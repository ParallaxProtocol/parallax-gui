// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// On Linux a USB device is root's until a udev rule gives it to the user
// at the computer: Ledger's and Trezor's own packages install theirs, an
// AppImage can't. The rules here are theirs, by vendor and product, with
// uaccess (the logged-in user's, through logind) in place of a plugdev
// group not every distribution has. The app reaches the devices through
// libusb, so the USB nodes need them as well as the hidraw ones.
const udevRulesPath = "/etc/udev/rules.d/51-parallax-wallet-hardware.rules"

const udevRules = `# Ledger and Trezor hardware wallets, for Parallax Wallet
# Ledger
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2c97", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
# Trezor One (HID firmware)
SUBSYSTEM=="usb", ATTR{idVendor}=="534c", ATTR{idProduct}=="0001", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
KERNEL=="hidraw*", ATTRS{idVendor}=="534c", ATTRS{idProduct}=="0001", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
# Trezor (WebUSB firmware, and its bootloader)
SUBSYSTEM=="usb", ATTR{idVendor}=="1209", ATTR{idProduct}=="53c0", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
SUBSYSTEM=="usb", ATTR{idVendor}=="1209", ATTR{idProduct}=="53c1", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
KERNEL=="hidraw*", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="53c1", MODE="0660", TAG+="uaccess", TAG+="udev-acl"
`

// ErrUSBSetupCancelled is the user closing the system's password prompt.
var ErrUSBSetupCancelled = errors.New("hardware: the USB access setup was cancelled")

// usbSetupNeeded reports whether the app's udev rules aren't installed as
// they are now.
func usbSetupNeeded() bool {
	data, err := os.ReadFile(udevRulesPath)
	return err != nil || string(data) != udevRules
}

// HardwareSetupUSB installs the udev rules that let the user at the
// computer open Ledgers and Trezors, through pkexec, which asks for an
// administrator's password, and has udev apply them to the devices plugged
// in. Only the rules file is written, by install from a copy the app made.
func (w *Wallet) HardwareSetupUSB() error {
	pkexec, err := exec.LookPath("pkexec")
	if err != nil {
		return fmt.Errorf("hardware: no pkexec to ask for the administrator's password: install the rules in %s by hand", udevRulesPath)
	}
	tmp, err := os.CreateTemp("", "parallax-wallet-*.rules")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(udevRules); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// The paths go in as arguments, never into the script
	script := `install -m 0644 "$1" "$2" && udevadm control --reload-rules && udevadm trigger --subsystem-match=usb --subsystem-match=hidraw`
	out, err := exec.Command(pkexec, "/bin/sh", "-c", script, "sh", tmp.Name(), udevRulesPath).CombinedOutput()
	var exit *exec.ExitError
	if errors.As(err, &exit) && (exit.ExitCode() == 126 || exit.ExitCode() == 127) {
		// pkexec's codes for the prompt dismissed, or not authorised
		return ErrUSBSetupCancelled
	}
	if err != nil {
		return fmt.Errorf("hardware: setting up USB access failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}
