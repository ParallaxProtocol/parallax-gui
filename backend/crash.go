// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"
)

var (
	crashOnce  sync.Once
	crashAlert func(string)
)

// InstallCrashHandler registers a global panic recovery hook. The hook
// writes a stack trace + environment snapshot to <userConfigDir>/Parallax/
// crash-<unix>.log and invokes onCrash with the file path so the GUI can
// surface a "report a bug" dialog.
//
// The Electron shell reports the backend process dying on its own; this is
// the catch-all that writes down why, for the goroutine that hosts the
// embedded node.
func InstallCrashHandler(onCrash func(reportPath string)) {
	crashOnce.Do(func() {
		crashAlert = onCrash
	})
}

// RecoverGoroutine should be deferred at the top of any goroutine the GUI
// spawns. It re-panics after writing the crash report so that go test and
// production logs still see the failure.
func RecoverGoroutine(name string) {
	if r := recover(); r != nil {
		path := writeCrashReport(name, r, debug.Stack())
		if crashAlert != nil {
			crashAlert(path)
		}
		panic(r)
	}
}

func writeCrashReport(name string, r interface{}, stack []byte) string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	dir = filepath.Join(dir, appDirName())
	_ = os.MkdirAll(dir, 0o700)

	// Readable by the user only, like everything else the app writes
	path := filepath.Join(dir, fmt.Sprintf("crash-%d.log", time.Now().Unix()))
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return ""
	}
	defer f.Close()
	fmt.Fprintf(f, "Parallax Wallet %s\n", GUIVersion)
	fmt.Fprintf(f, "Time: %s\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(f, "Goroutine: %s\n", name)
	fmt.Fprintf(f, "Panic: %v\n\n", r)
	f.Write(stack)
	return path
}
