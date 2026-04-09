// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"

	"github.com/ParallaxProtocol/parallax/log"
)

// addDefenderExclusion adds a Windows Defender exclusion for the given path.
// Mining binaries are commonly flagged as PUA:Win32/CoinMiner by Defender,
// so we exclude the install directory to prevent hashwarp from being deleted.
// This requires elevated privileges; if the current process is not elevated
// it runs PowerShell via "runas" verb to trigger a UAC prompt.
func addDefenderExclusion(path string) error {
	// First check if the exclusion already exists.
	checkCmd := fmt.Sprintf(`(Get-MpPreference).ExclusionPath -contains '%s'`, path)
	out, err := runPowerShell(checkCmd, false)
	if err == nil && strings.TrimSpace(out) == "True" {
		log.Info("Defender exclusion already exists", "path", path)
		return nil
	}

	// Add the exclusion. This requires admin privileges.
	addCmd := fmt.Sprintf(`Add-MpPreference -ExclusionPath '%s'`, path)
	if _, err := runPowerShell(addCmd, true); err != nil {
		return fmt.Errorf("add Defender exclusion: %w", err)
	}

	log.Info("Added Defender exclusion", "path", path)
	return nil
}

// runPowerShell executes a PowerShell command. If elevated is true and the
// current process is not running as admin, it uses ShellExecute with "runas"
// to trigger a UAC elevation prompt.
func runPowerShell(command string, elevated bool) (string, error) {
	if elevated && !isAdmin() {
		return runElevatedPowerShell(command)
	}

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", command)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// runElevatedPowerShell runs a PowerShell command via ShellExecute "runas"
// verb, which triggers a UAC prompt if the current process is not elevated.
func runElevatedPowerShell(command string) (string, error) {
	cmd := exec.Command("powershell",
		"-NoProfile", "-NonInteractive",
		"-Command", fmt.Sprintf("Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-NonInteractive','-Command','%s'",
			strings.ReplaceAll(command, "'", "''")))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// isAdmin checks whether the current process has administrator privileges.
func isAdmin() bool {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		"([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "True"
}
