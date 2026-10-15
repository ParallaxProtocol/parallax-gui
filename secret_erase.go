// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build goexperiment.runtimesecret

package main

import "runtime/secret"

// erasing runs f under runtime/secret: once it returns, the registers and
// stack it used are wiped, and every heap allocation it made is wiped when
// the garbage collector frees it. That reaches the copies the code under it
// makes and never wipes itself: the password strings decoded from a call,
// and what the keystore, scrypt and the signer allocate along the way. It
// needs GOEXPERIMENT=runtimesecret (set for Linux builds, the Makefile) and
// so far erases only on linux/amd64 and linux/arm64.
func erasing(f func()) { secret.Do(f) }
