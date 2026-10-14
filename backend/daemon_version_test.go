// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import "testing"

func TestPseudoCommit(t *testing.T) {
	for v, want := range map[string]string{
		"v2.1.4-0.20260101120000-71d7cead1f67":            "71d7cead1f67",
		"v2.1.3-pre.0.20260101120000-71d7cead1f67":        "71d7cead1f67",
		"v0.0.0-20260101120000-abcdef012345+incompatible": "abcdef012345",
		"v2.1.3": "",
	} {
		got := ""
		if m := pseudoCommit.FindStringSubmatch(v); m != nil {
			got = m[1]
		}
		if got != want {
			t.Errorf("commit of %s = %q, want %q", v, got, want)
		}
	}
}
