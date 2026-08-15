//go:build linux && webkit2_41

package main

/*
#cgo pkg-config: webkit2gtk-4.1
#include <webkit2/webkit2.h>
*/
import "C"

// webkitVersion returns the runtime WebKitGTK version the app is linked
// against. Used to decide whether compositor-specific workarounds are
// still needed (see main.go).
func webkitVersion() (major, minor uint) {
	return uint(C.webkit_get_major_version()), uint(C.webkit_get_minor_version())
}
