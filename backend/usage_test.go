// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/support/metrics"
)

// Without --metrics (as under go test) the daemon counts nothing, and the
// usage says so rather than reading as none.
func TestNodeUsageUncounted(t *testing.T) {
	if metrics.Enabled {
		t.Skip("metrics are on in this process")
	}
	if got := NodeUsage(); got != (Usage{}) {
		t.Fatalf("usage without metrics = %+v, want the zero value", got)
	}
}
