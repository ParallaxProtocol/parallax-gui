// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ParallaxProtocol/parallax/v2/logging"
)

const (
	guiReleasesAPI = "https://api.github.com/repos/ParallaxProtocol/parallax-gui/releases/latest"
	// guiReleaseListAPI lists the releases, newest first, for their notes
	guiReleaseListAPI = "https://api.github.com/repos/ParallaxProtocol/parallax-gui/releases?per_page=100"
	checkCooldown     = 5 * time.Minute // minimum interval between checks
)

// Updater checks GitHub Releases for new versions of Parallax Wallet and
// handles downloading, verifying, and replacing the running binary.
type Updater struct {
	mu          sync.Mutex
	latest      *UpdateInfo
	downloading bool
	lastCheck   time.Time
	emitter     func(UpdateProgress)
	// found is told each release a check finds, for the app to offer at once
	found  func(*UpdateInfo)
	stopCh chan struct{}
	// http is what the checks and downloads go by: through Tor while its
	// switch is on (tor.go)
	http *http.Client
	// installer is a downloaded Windows installer waiting to be run by the
	// shell on restart.
	installer string
}

// portableExe is the path of the Windows portable executable the app was
// started from, which the shell passes in from electron-builder's
// PORTABLE_EXECUTABLE_FILE; empty for an installed copy.
func portableExe() string { return os.Getenv("PARALLAX_PORTABLE_EXE") }

// PendingInstaller returns the downloaded installer the shell should run
// on restart, or "" when the update was installed in place.
func (u *Updater) PendingInstaller() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.installer
}

// NewUpdater creates a new Updater.
func NewUpdater(hc *http.Client) *Updater {
	return &Updater{
		stopCh: make(chan struct{}),
		http:   hc,
	}
}

// SetEmitter installs the callback used to stream progress events to the
// frontend.
func (u *Updater) SetEmitter(fn func(UpdateProgress)) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.emitter = fn
}

// OnFound installs the callback told each newer release a check finds,
// as it finds it, so the app needn't wait to ask for it.
func (u *Updater) OnFound(fn func(*UpdateInfo)) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.found = fn
}

func (u *Updater) emit(p UpdateProgress) {
	u.mu.Lock()
	fn := u.emitter
	u.mu.Unlock()
	if fn != nil {
		fn(p)
	}
}

// StartPeriodicCheck starts a background goroutine that checks for updates
// shortly after startup and then every interval, skipping each check while
// enabled reports false (the user turned background checks off).
func (u *Updater) StartPeriodicCheck(interval time.Duration, enabled func() bool) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logging.Error("Updater panic", "err", r)
			}
		}()

		// Initial check after a short delay to let the app finish starting.
		select {
		case <-time.After(5 * time.Second):
		case <-u.stopCh:
			return
		}

		if enabled() {
			if _, err := u.CheckForUpdate(); err != nil {
				logging.Warn("Auto-update check failed", "err", err)
			}
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if !enabled() {
					continue
				}
				if _, err := u.CheckForUpdate(); err != nil {
					logging.Warn("Auto-update check failed", "err", err)
				}
			case <-u.stopCh:
				return
			}
		}
	}()
}

// Stop terminates the periodic check goroutine.
func (u *Updater) Stop() {
	select {
	case <-u.stopCh:
	default:
		close(u.stopCh)
	}
}

// Latest returns the cached update info, or nil if no update is available.
func (u *Updater) Latest() *UpdateInfo {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.latest
}

// CheckForUpdate queries the GitHub Releases API and returns update info if a
// newer version is available. Returns nil when already up-to-date.
func (u *Updater) CheckForUpdate() (*UpdateInfo, error) {
	u.mu.Lock()
	if time.Since(u.lastCheck) < checkCooldown {
		cached := u.latest
		u.mu.Unlock()
		return cached, nil
	}
	u.lastCheck = time.Now()
	u.mu.Unlock()

	logging.Info("Checking for updates", "current", GUIVersion)

	resp, err := u.http.Get(guiReleasesAPI)
	if err != nil {
		return nil, fmt.Errorf("fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Body        string `json:"body"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		Assets      []struct {
			Name               string `json:"name"`
			Size               int64  `json:"size"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}

	// Skip drafts and prereleases.
	if release.Draft || release.Prerelease {
		logging.Debug("Latest release is draft/prerelease, skipping", "tag", release.TagName)
		return nil, nil
	}

	// Strip leading "v" from tag.
	latestVersion := strings.TrimPrefix(release.TagName, "v")

	if !semverNewer(GUIVersion, latestVersion) {
		logging.Info("Already up to date", "current", GUIVersion, "latest", latestVersion)
		u.mu.Lock()
		u.latest = nil
		u.mu.Unlock()
		return nil, nil
	}

	// Find the matching asset for this OS/arch. The release publishes one
	// native artifact per platform: AppImage on Linux, DMG on macOS,
	// portable .exe on Windows (the NSIS installer is uploaded separately
	// and is not what the in-app updater consumes).
	wantName := desiredAssetName(latestVersion)
	if wantName == "" {
		return nil, fmt.Errorf("auto-update unsupported on %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	var assetURL string
	var assetName string
	var assetSize int64

	for _, a := range release.Assets {
		if a.Name == wantName {
			assetURL = a.BrowserDownloadURL
			assetName = a.Name
			assetSize = a.Size
			break
		}
	}

	if assetURL == "" {
		return nil, fmt.Errorf("no matching asset %q in release %s", wantName, release.TagName)
	}

	info := &UpdateInfo{
		CurrentVersion: GUIVersion,
		LatestVersion:  latestVersion,
		ReleaseURL:     release.HTMLURL,
		AssetURL:       assetURL,
		AssetName:      assetName,
		AssetSize:      assetSize,
		PublishedAt:    release.PublishedAt,
	}
	latestNotes := ReleaseNotes{
		Version:     latestVersion,
		PublishedAt: release.PublishedAt,
		URL:         release.HTMLURL,
		Notes:       clipNotes(release.Body),
	}
	info.Releases = u.notesSince(GUIVersion, latestNotes)

	u.mu.Lock()
	u.latest = info
	found := u.found
	u.mu.Unlock()
	if found != nil {
		found(info)
	}

	logging.Info("Update available", "current", GUIVersion, "latest", latestVersion)
	return info, nil
}

// DownloadAndInstall downloads the latest release, verifies its SHA256, and
// hands the artifact to the OS-specific installer. Progress is streamed via
// the emitter.
func (u *Updater) DownloadAndInstall(ctx context.Context) error {
	u.mu.Lock()
	if u.downloading {
		u.mu.Unlock()
		return fmt.Errorf("update already in progress")
	}
	info := u.latest
	u.downloading = true
	u.mu.Unlock()

	defer func() {
		u.mu.Lock()
		u.downloading = false
		u.mu.Unlock()
	}()

	if info == nil {
		return fmt.Errorf("no update available")
	}

	// 1. Download the artifact with progress.
	u.emit(UpdateProgress{Step: "downloading", Percent: 0, Detail: info.AssetName})
	tmpFile, err := u.downloadWithProgress(ctx, info.AssetURL, info.AssetSize)
	if err != nil {
		u.emit(UpdateProgress{Step: "error", Detail: fmt.Sprintf("Download failed: %v", err)})
		return fmt.Errorf("download: %w", err)
	}
	keepDownload := false
	defer func() {
		if !keepDownload {
			os.Remove(tmpFile)
		}
	}()

	// 2. Verify SHA256.
	u.emit(UpdateProgress{Step: "verifying", Detail: "Checking integrity..."})
	if err := u.verifySHA256(info, tmpFile); err != nil {
		u.emit(UpdateProgress{Step: "error", Detail: fmt.Sprintf("Verification failed: %v", err)})
		return fmt.Errorf("verify: %w", err)
	}

	// 3. Install per platform.
	u.emit(UpdateProgress{Step: "extracting", Detail: "Installing update..."})
	manual, installer, err := installArtifact(tmpFile, info.AssetName)
	if err != nil {
		u.emit(UpdateProgress{Step: "error", Detail: fmt.Sprintf("Install failed: %v", err)})
		return fmt.Errorf("install: %w", err)
	}
	if installer != "" {
		// The shell runs it on restart
		keepDownload = true
		u.mu.Lock()
		u.installer = installer
		u.mu.Unlock()
	}

	if manual {
		// macOS DMG: leave the file on disk so the user can finish in Finder.
		keepDownload = true
		u.emit(UpdateProgress{Step: "ready-manual", Detail: "Drag Parallax Wallet to Applications."})
	} else {
		u.emit(UpdateProgress{Step: "ready", Detail: "Update installed. Restart to apply."})
	}
	logging.Info("Update installed", "version", info.LatestVersion, "manual", manual)
	return nil
}

// desiredAssetName returns the release artifact filename the in-app updater
// expects for the running platform/architecture, or "" if auto-update is not
// supported here.
func desiredAssetName(version string) string {
	dispArch := ""
	switch runtime.GOARCH {
	case "amd64":
		dispArch = "x86_64"
	case "arm64":
		dispArch = "arm64"
	default:
		return ""
	}
	switch runtime.GOOS {
	case "linux":
		return fmt.Sprintf("Parallax-Wallet-%s-linux-%s.AppImage", version, dispArch)
	case "darwin":
		return fmt.Sprintf("Parallax-Wallet-%s-macos-%s.dmg", version, dispArch)
	case "windows":
		if runtime.GOARCH != "amd64" {
			return ""
		}
		// A portable copy updates by replacing its executable; an installed
		// one runs the next version's installer
		if portableExe() != "" {
			return fmt.Sprintf("Parallax-Wallet-%s-windows-x86_64.exe", version)
		}
		return fmt.Sprintf("Parallax-Wallet-%s-windows-x86_64-setup.exe", version)
	}
	return ""
}

// downloadWithProgress downloads a URL to a temp file, emitting progress
// events based on the expected size.
func (u *Updater) downloadWithProgress(ctx context.Context, url string, expectedSize int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", err
	}

	resp, err := u.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download returned %d", resp.StatusCode)
	}

	total := resp.ContentLength
	if total <= 0 {
		total = expectedSize
	}

	tmp, err := os.CreateTemp("", "parallax-update-*.zip")
	if err != nil {
		return "", err
	}

	var written int64
	buf := make([]byte, 32*1024)
	lastPct := -1

	for {
		nr, readErr := resp.Body.Read(buf)
		if nr > 0 {
			nw, writeErr := tmp.Write(buf[:nr])
			if writeErr != nil {
				tmp.Close()
				os.Remove(tmp.Name())
				return "", writeErr
			}
			written += int64(nw)

			if total > 0 {
				pct := int(written * 100 / total)
				if pct > 100 {
					pct = 100
				}
				if pct != lastPct {
					lastPct = pct
					u.emit(UpdateProgress{Step: "downloading", Percent: pct, Detail: fmt.Sprintf("%d%%", pct)})
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			tmp.Close()
			os.Remove(tmp.Name())
			return "", readErr
		}
	}

	tmp.Close()
	return tmp.Name(), nil
}

// verifySHA256 downloads SHA256SUMS.txt from the release and verifies the
// downloaded file's hash matches.
func (u *Updater) verifySHA256(info *UpdateInfo, zipPath string) error {
	// Derive SHA256SUMS.txt URL from the asset URL.
	// Asset URLs: https://github.com/.../releases/download/<tag>/<filename>
	sumsURL := strings.TrimSuffix(info.AssetURL, info.AssetName) + "SHA256SUMS.txt"

	// Every release publishes its hashes: without them the download isn't
	// installed, whatever kept them from being read
	resp, err := u.http.Get(sumsURL)
	if err != nil {
		return fmt.Errorf("fetch SHA256SUMS.txt: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("fetch SHA256SUMS.txt: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read SHA256SUMS.txt: %w", err)
	}

	// Parse: each line is "<hash>  <filename>" or "<hash> <filename>"
	var expectedHash string
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[1] == info.AssetName {
			expectedHash = fields[0]
			break
		}
	}

	if expectedHash == "" {
		return fmt.Errorf("%s is not in SHA256SUMS.txt", info.AssetName)
	}

	f, err := os.Open(zipPath)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("hash file: %w", err)
	}

	actualHash := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(actualHash, expectedHash) {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	logging.Info("SHA256 verification passed", "hash", actualHash)
	return nil
}

// installArtifact installs a downloaded release artifact for the running
// platform. It returns manual=true when the install requires user action to
// finish (currently: macOS DMG, where the user has to drag the .app to
// /Applications themselves), and the path of an installer the shell must
// run on restart (an installed Windows copy).
func installArtifact(downloadPath, assetName string) (manual bool, installer string, err error) {
	switch runtime.GOOS {
	case "windows":
		if portableExe() == "" {
			// Give the installer its own name, so Windows shows it as such
			named := filepath.Join(filepath.Dir(downloadPath), assetName)
			if err := os.Rename(downloadPath, named); err != nil {
				return false, "", fmt.Errorf("stage installer: %w", err)
			}
			return false, named, nil
		}
		target, terr := currentBinaryPath()
		if terr != nil {
			return false, "", terr
		}
		return false, "", replaceFileInPlace(downloadPath, target, false)
	case "linux":
		target, terr := currentBinaryPath()
		if terr != nil {
			return false, "", terr
		}
		return false, "", replaceFileInPlace(downloadPath, target, true)
	case "darwin":
		// We can't safely modify the running .app bundle in place
		// (codesigning + Gatekeeper). Open the DMG in Finder; the user
		// drags Parallax Wallet.app to /Applications.
		stableDir := filepath.Dir(downloadPath)
		stable := filepath.Join(stableDir, assetName)
		if stable != downloadPath {
			if err := os.Rename(downloadPath, stable); err == nil {
				downloadPath = stable
			}
		}
		cmd := exec.Command("open", downloadPath)
		if err := cmd.Run(); err != nil {
			return true, "", fmt.Errorf("open dmg: %w", err)
		}
		return true, "", nil
	}
	return false, "", fmt.Errorf("unsupported platform %s", runtime.GOOS)
}

// currentBinaryPath returns the on-disk path of the artifact that should be
// replaced when an update is installed. On Linux this is the AppImage file
// (read from $APPIMAGE) — os.Executable() points inside the read-only FUSE
// mount, which is not what we want to overwrite.
func currentBinaryPath() (string, error) {
	if runtime.GOOS == "linux" {
		if appimg := os.Getenv("APPIMAGE"); appimg != "" {
			abs, err := filepath.Abs(appimg)
			if err != nil {
				return "", fmt.Errorf("resolve APPIMAGE: %w", err)
			}
			return abs, nil
		}
		return "", fmt.Errorf("not running from an AppImage ($APPIMAGE unset); auto-update is only supported for AppImage builds")
	}
	if runtime.GOOS == "windows" {
		if p := portableExe(); p != "" {
			return p, nil
		}
		return "", fmt.Errorf("installed copies update through the installer")
	}
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", fmt.Errorf("eval symlinks: %w", err)
	}
	return exe, nil
}

// replaceFileInPlace performs the rename dance to swap target with src:
// move src → target.new, target → target.old, target.new → target. The
// running process keeps its open .old handle (works on Windows because the
// rename happens before any deletion of the in-use file).
func replaceFileInPlace(src, target string, makeExecutable bool) error {
	newPath := target + ".new"
	oldPath := target + ".old"

	// Move the downloaded file next to the target so the final rename is
	// guaranteed to be on the same filesystem (avoids EXDEV).
	_ = os.Remove(newPath)
	if err := os.Rename(src, newPath); err != nil {
		// Cross-device fallback: copy.
		if err := copyFile(src, newPath); err != nil {
			return fmt.Errorf("stage update: %w", err)
		}
		_ = os.Remove(src)
	}

	if makeExecutable {
		if err := os.Chmod(newPath, 0o755); err != nil {
			os.Remove(newPath)
			return fmt.Errorf("chmod: %w", err)
		}
	}

	_ = os.Remove(oldPath)

	if err := os.Rename(target, oldPath); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("backup current binary: %w", err)
	}

	if err := os.Rename(newPath, target); err != nil {
		_ = os.Rename(oldPath, target)
		return fmt.Errorf("install new binary: %w", err)
	}

	logging.Info("Binary replaced", "path", target)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}

// CleanupOldBinary removes any leftover .old binary from a previous update.
func CleanupOldBinary() {
	target, err := currentBinaryPath()
	if err != nil {
		return
	}
	oldPath := target + ".old"
	if _, err := os.Stat(oldPath); err == nil {
		if err := os.Remove(oldPath); err != nil {
			logging.Warn("Failed to clean up old binary", "path", oldPath, "err", err)
		} else {
			logging.Info("Cleaned up old binary", "path", oldPath)
		}
	}
}

// semverNewer reports whether candidate is newer than current.
// Both must be dotted numeric versions (e.g. "0.1.0", "1.2.3").
func semverNewer(current, candidate string) bool {
	parse := func(s string) []int {
		parts := strings.Split(s, ".")
		nums := make([]int, len(parts))
		for i, p := range parts {
			n, _ := strconv.Atoi(p)
			nums[i] = n
		}
		return nums
	}

	cur := parse(current)
	cand := parse(candidate)

	for len(cur) < len(cand) {
		cur = append(cur, 0)
	}
	for len(cand) < len(cur) {
		cand = append(cand, 0)
	}

	for i := range cur {
		if cand[i] > cur[i] {
			return true
		}
		if cand[i] < cur[i] {
			return false
		}
	}
	return false
}

// githubRelease is what the release list says of each release.
type githubRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Body        string `json:"body"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

// notesSince reads the notes of every release from the one running to the
// latest, for the app to show what updating brings. Without the list
// (GitHub unreachable, or refusing), the latest's notes alone.
func (u *Updater) notesSince(current string, latest ReleaseNotes) []ReleaseNotes {
	list, err := u.releases()
	if err != nil {
		logging.Warn("Failed to read the releases' notes", "err", err)
		return []ReleaseNotes{latest}
	}
	return releasesBetween(list, current, latest)
}

// NotesUpTo reads the notes of every release up to the one running, newest
// first: what the app has come to be, for Settings' About to show.
func (u *Updater) NotesUpTo(current string) ([]ReleaseNotes, error) {
	list, err := u.releases()
	if err != nil {
		return nil, err
	}
	return releasesUpTo(list, current), nil
}

// releases reads the release list, newest first.
func (u *Updater) releases() ([]githubRelease, error) {
	resp, err := u.http.Get(guiReleaseListAPI)
	if err != nil {
		return nil, fmt.Errorf("fetch releases: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}
	var list []githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseList)).Decode(&list); err != nil {
		return nil, fmt.Errorf("decode releases: %w", err)
	}
	return list, nil
}

// releasesUpTo keeps, of a release list, the published releases no newer
// than current, newest first, each one's notes clipped.
func releasesUpTo(list []githubRelease, current string) []ReleaseNotes {
	out := []ReleaseNotes{}
	for _, r := range list {
		v := strings.TrimPrefix(r.TagName, "v")
		if r.Draft || r.Prerelease || semverNewer(current, v) {
			continue
		}
		out = append(out, ReleaseNotes{Version: v, PublishedAt: r.PublishedAt, URL: r.HTMLURL, Notes: clipNotes(r.Body)})
	}
	sort.SliceStable(out, func(i, j int) bool { return semverNewer(out[j].Version, out[i].Version) })
	if len(out) > maxReleasesShown {
		out = out[:maxReleasesShown]
	}
	return out
}

// maxReleaseList bounds the release list read: a hundred releases' notes
// and assets, with plenty of room.
const maxReleaseList = 16 << 20

// maxReleasesShown bounds how many releases' notes are kept, newest first.
const maxReleasesShown = 50

// releasesBetween keeps, of a release list, the published releases newer
// than current and no newer than latest, newest first, each one's notes
// clipped; latest's own (from the release it was found by) always first.
func releasesBetween(list []githubRelease, current string, latest ReleaseNotes) []ReleaseNotes {
	out := []ReleaseNotes{latest}
	for _, r := range list {
		v := strings.TrimPrefix(r.TagName, "v")
		if r.Draft || r.Prerelease || v == latest.Version {
			continue
		}
		if !semverNewer(current, v) || semverNewer(latest.Version, v) {
			continue
		}
		out = append(out, ReleaseNotes{Version: v, PublishedAt: r.PublishedAt, URL: r.HTMLURL, Notes: clipNotes(r.Body)})
	}
	sort.SliceStable(out[1:], func(i, j int) bool { return semverNewer(out[1+j].Version, out[1+i].Version) })
	if len(out) > maxReleasesShown {
		out = out[:maxReleasesShown]
	}
	return out
}

// maxNotes bounds the release notes kept for the app to show.
const maxNotes = 64 << 10

// clipNotes keeps a release's notes to maxNotes bytes, cut at a rune.
func clipNotes(s string) string {
	if len(s) <= maxNotes {
		return s
	}
	s = s[:maxNotes]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s + "…"
}
