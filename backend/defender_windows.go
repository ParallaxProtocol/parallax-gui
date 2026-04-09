// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/ParallaxProtocol/parallax/log"
)

// addDefenderExclusion adds a Windows Defender exclusion for the given path.
// Mining binaries are commonly flagged as PUA:Win32/CoinMiner by Defender,
// so we exclude the install directory to prevent hashwarp from being deleted.
// This requires elevated privileges and triggers a UAC prompt.
func addDefenderExclusion(path string) error {
	// Check if the exclusion already exists (no elevation needed).
	if hasDefenderExclusion(path) {
		log.Info("Defender exclusion already exists", "path", path)
		return nil
	}

	// Write the Add-MpPreference command to a temp .ps1 script so we don't
	// have to deal with nested PowerShell quoting.
	script, err := os.CreateTemp("", "prlx-defender-*.ps1")
	if err != nil {
		return fmt.Errorf("create temp script: %w", err)
	}
	scriptPath := script.Name()
	defer os.Remove(scriptPath)

	fmt.Fprintf(script, "Add-MpPreference -ExclusionPath '%s'\n", path)
	script.Close()

	// Use Start-Process with -Verb RunAs to trigger UAC elevation.
	// -Wait blocks until the elevated process exits.
	// -WindowStyle Hidden keeps the elevated PowerShell window invisible
	// (the UAC prompt itself always shows on the secure desktop).
	psCmd := fmt.Sprintf(
		`Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%s"'`,
		scriptPath)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psCmd)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("run elevated PowerShell: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}

	// Verify the exclusion was actually added, since we can't capture
	// output from the elevated child process.
	if !hasDefenderExclusion(path) {
		return fmt.Errorf("exclusion was not added — the UAC prompt may have been denied")
	}

	log.Info("Added Defender exclusion", "path", path)
	return nil
}

// hasDefenderExclusion checks whether the given path is already in
// Defender's exclusion list. Does not require elevation.
func hasDefenderExclusion(path string) bool {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf(`(Get-MpPreference).ExclusionPath -contains '%s'`, path))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return err == nil && strings.TrimSpace(string(out)) == "True"
}
