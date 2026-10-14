// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/logging"
)

// A line logged from this app's own code is the app's, not the node's.
func TestRecordSourceApp(t *testing.T) {
	var got string
	logger := logging.New()
	logger.SetHandler(logging.FuncHandler(func(r *logging.Record) error {
		got = recordSource(r)
		return nil
	}))
	logger.Info("hello")
	if got != "app" {
		t.Fatalf("source of a line logged here = %q, want app", got)
	}
}
