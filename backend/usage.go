// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"runtime"

	"github.com/ParallaxProtocol/parallax/v2/support/metrics"
)

// Usage is what the node takes of the computer: its peer traffic and its
// disk traffic since the app started, from the daemon's own metrics, and
// the CPU time the process has used, read from the system; the app works
// out speeds and loads from successive readings. The machine's own CPU
// load comes from the daemon's collector, over its last few seconds.
type Usage struct {
	// Counted is false when the daemon isn't collecting metrics, and the
	// rest is meaningless.
	Counted bool `json:"counted"`

	// Bytes from and to peers, across node restarts
	InBytes  uint64 `json:"inBytes"`
	OutBytes uint64 `json:"outBytes"`
	// Bytes the process read from and wrote to disk
	DiskReadBytes  uint64 `json:"diskReadBytes"`
	DiskWriteBytes uint64 `json:"diskWriteBytes"`

	// CPUSeconds is the CPU time the process has used since it started;
	// CPUCounted is false if the system wouldn't say.
	CPUCounted bool    `json:"cpuCounted"`
	CPUSeconds float64 `json:"cpuSeconds"`
	// The whole machine's CPU load and its time waiting on I/O, as shares
	// (0..1) of all its cores
	CPUSystem float64 `json:"cpuSystem"`
	CPUWait   float64 `json:"cpuWait"`
	Cores     int     `json:"cores"`
}

// The daemon's metric names (p2p/metrics.go, support/metrics/metrics.go)
const (
	ingressMeter    = "p2p/ingress"
	egressMeter     = "p2p/egress"
	diskReadCounter = "system/disk/readbytes"
	diskWriteCount  = "system/disk/writebytes"
	cpuSysGauge     = "system/cpu/sysload"
	cpuWaitGauge    = "system/cpu/syswait"
)

// NodeUsage reads the daemon's metrics. They count only while metrics are
// collected, which the shell turns on as it starts the backend.
func NodeUsage() Usage {
	if !metrics.Enabled {
		return Usage{}
	}
	cores := runtime.NumCPU()
	// The CPU gauges are hundredths of a second of CPU time per second,
	// summed over the cores: 100 is one core kept busy
	share := func(name string) float64 {
		return float64(gauge(name)) / 100 / float64(cores)
	}
	cpuSeconds, cpuCounted := processCPUSeconds()
	return Usage{
		Counted:        true,
		InBytes:        meterCount(ingressMeter),
		OutBytes:       meterCount(egressMeter),
		DiskReadBytes:  counterCount(diskReadCounter),
		DiskWriteBytes: counterCount(diskWriteCount),
		CPUCounted:     cpuCounted,
		CPUSeconds:     cpuSeconds,
		CPUSystem:      share(cpuSysGauge),
		CPUWait:        share(cpuWaitGauge),
		Cores:          cores,
	}
}

func meterCount(name string) uint64 {
	if m, ok := metrics.DefaultRegistry.Get(name).(metrics.Meter); ok {
		return nonNegative(m.Count())
	}
	return 0
}

func counterCount(name string) uint64 {
	if c, ok := metrics.DefaultRegistry.Get(name).(metrics.Counter); ok {
		return nonNegative(c.Count())
	}
	return 0
}

func gauge(name string) int64 {
	if g, ok := metrics.DefaultRegistry.Get(name).(metrics.Gauge); ok {
		return g.Value()
	}
	return 0
}

func nonNegative(n int64) uint64 {
	if n > 0 {
		return uint64(n)
	}
	return 0
}
