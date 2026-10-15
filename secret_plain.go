// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !goexperiment.runtimesecret

package main

// erasing runs f. Built with GOEXPERIMENT=runtimesecret it also wipes what
// f leaves in memory (secret_erase.go).
func erasing(f func()) { f() }
