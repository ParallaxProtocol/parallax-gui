// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"regexp"
	"runtime/debug"
)

// DaemonCommit is the commit of the Parallax client this app embeds (the
// github.com/ParallaxProtocol/parallax/v2 module), stamped in by the build
// (Makefile) from the module's origin, as a release's own version string
// carries it. A module built from a tag records no commit of its own.
var DaemonCommit = ""

const daemonModule = "github.com/ParallaxProtocol/parallax/v2"

// A pseudo-version (an untagged commit) ends in its commit's first 12 digits
var pseudoCommit = regexp.MustCompile(`\d{14}-([0-9a-f]{12})(?:\+incompatible)?$`)

// daemonCommit is the Parallax client's commit: the stamped one, or the
// one in its pseudo-version when it is built from an untagged commit, or
// empty when neither says.
func daemonCommit() string {
	if DaemonCommit != "" {
		return DaemonCommit
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path != daemonModule {
			continue
		}
		if dep.Replace != nil {
			dep = dep.Replace
		}
		if m := pseudoCommit.FindStringSubmatch(dep.Version); m != nil {
			return m[1]
		}
	}
	return ""
}
