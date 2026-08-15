//go:build !linux || !webkit2_41

package main

// webkitVersion is only meaningful on Linux builds linked against
// WebKitGTK (webkit2_41 tag). Elsewhere report zero, which callers treat
// as "unknown — keep conservative workarounds".
func webkitVersion() (major, minor uint) {
	return 0, 0
}
