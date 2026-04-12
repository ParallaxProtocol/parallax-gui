// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// GeoLocation is one resolved IP -> coordinates mapping. Lat/Lon are zero
// when the lookup failed; the frontend filters those out before drawing.
type GeoLocation struct {
	IP      string  `json:"ip"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	City    string  `json:"city"`
	Country string  `json:"country"`
}

// PublicNode is one entry from the parallaxprotocol.org public node
// directory. Anonymous on purpose — the directory only exposes coordinates
// and country, never IPs or node IDs.
type PublicNode struct {
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	City        string  `json:"city"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
}

// GeoLocator looks IPs up against ip-api.com and caches the results in
// memory for the lifetime of the GUI process. ip-api.com is free, requires
// no API key and supports a /batch endpoint that takes up to 100 IPs in one
// request — perfect for the per-poll peer fan-out the dashboard does.
//
// It also caches the parallaxprotocol.org public node directory with a
// short TTL so the world map can render the global network without
// hammering the upstream every poll.
type GeoLocator struct {
	mu    sync.RWMutex
	cache map[string]GeoLocation
	self  *GeoLocation
	http  *http.Client

	publicMu      sync.RWMutex
	publicNodes   []PublicNode
	publicFetched time.Time
}

const publicNodesTTL = 5 * time.Minute
const publicNodesURL = "https://parallaxprotocol.org/api/nodes"

func NewGeoLocator() *GeoLocator {
	return &GeoLocator{
		cache: make(map[string]GeoLocation),
		http:  &http.Client{Timeout: 8 * time.Second},
	}
}

// LookupSelf returns the public IP / coordinates of the machine the GUI is
// running on. Cached for the lifetime of the process — the user's location
// doesn't change often enough to be worth re-resolving every poll.
func (g *GeoLocator) LookupSelf() (GeoLocation, error) {
	g.mu.RLock()
	cached := g.self
	g.mu.RUnlock()
	if cached != nil {
		return *cached, nil
	}

	req, err := http.NewRequest("GET", "http://ip-api.com/json/?fields=status,lat,lon,city,country,query", nil)
	if err != nil {
		return GeoLocation{}, err
	}
	resp, err := g.http.Do(req)
	if err != nil {
		return GeoLocation{}, err
	}
	defer resp.Body.Close()

	var body struct {
		Status  string  `json:"status"`
		Query   string  `json:"query"`
		Lat     float64 `json:"lat"`
		Lon     float64 `json:"lon"`
		City    string  `json:"city"`
		Country string  `json:"country"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return GeoLocation{}, err
	}
	if body.Status != "success" {
		return GeoLocation{}, errors.New("ip-api self lookup failed")
	}
	loc := GeoLocation{
		IP:      body.Query,
		Lat:     body.Lat,
		Lon:     body.Lon,
		City:    body.City,
		Country: body.Country,
	}
	g.mu.Lock()
	g.self = &loc
	g.mu.Unlock()
	return loc, nil
}

// LookupIPs resolves a slice of IP addresses to coordinates. Inputs may be
// "ip:port" or bare "ip" — the port is stripped. Loopback / private / IPv6
// link-local addresses are skipped because ip-api.com only knows about
// publicly routable space.
//
// Cached results are returned immediately; the remainder is sent to the
// /batch endpoint in chunks of 100. Failed lookups are still cached (with
// zero Lat/Lon) so we don't keep retrying a dead IP every 2-second poll.
func (g *GeoLocator) LookupIPs(inputs []string) []GeoLocation {
	out := make([]GeoLocation, 0, len(inputs))
	seen := make(map[string]bool, len(inputs))
	var pending []string

	g.mu.RLock()
	for _, raw := range inputs {
		ip := normalizeIP(raw)
		if ip == "" || seen[ip] {
			continue
		}
		seen[ip] = true
		if loc, ok := g.cache[ip]; ok {
			out = append(out, loc)
			continue
		}
		pending = append(pending, ip)
	}
	g.mu.RUnlock()

	if len(pending) == 0 {
		return out
	}

	for i := 0; i < len(pending); i += 100 {
		end := i + 100
		if end > len(pending) {
			end = len(pending)
		}
		results := g.batchLookup(pending[i:end])
		g.mu.Lock()
		for _, loc := range results {
			g.cache[loc.IP] = loc
			if loc.Lat != 0 || loc.Lon != 0 {
				out = append(out, loc)
			}
		}
		g.mu.Unlock()
	}
	return out
}

func (g *GeoLocator) batchLookup(ips []string) []GeoLocation {
	type query struct {
		Query  string `json:"query"`
		Fields string `json:"fields"`
	}
	body := make([]query, 0, len(ips))
	for _, ip := range ips {
		body = append(body, query{Query: ip, Fields: "status,lat,lon,city,country,query"})
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil
	}
	req, err := http.NewRequest("POST", "http://ip-api.com/batch", bytes.NewReader(buf))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.http.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	var raw []struct {
		Status  string  `json:"status"`
		Query   string  `json:"query"`
		Lat     float64 `json:"lat"`
		Lon     float64 `json:"lon"`
		City    string  `json:"city"`
		Country string  `json:"country"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil
	}
	out := make([]GeoLocation, 0, len(raw))
	for _, r := range raw {
		loc := GeoLocation{IP: r.Query}
		if r.Status == "success" {
			loc.Lat = r.Lat
			loc.Lon = r.Lon
			loc.City = r.City
			loc.Country = r.Country
		}
		out = append(out, loc)
	}
	return out
}

// PublicNodes returns the public node directory, refreshing from upstream
// at most once per publicNodesTTL. On fetch failure the previous cached
// snapshot is returned (or an empty slice if there's nothing cached yet)
// — the dashboard tolerates missing data better than an error path.
func (g *GeoLocator) PublicNodes() []PublicNode {
	g.publicMu.RLock()
	cached := g.publicNodes
	fetched := g.publicFetched
	g.publicMu.RUnlock()
	if time.Since(fetched) < publicNodesTTL && cached != nil {
		return cached
	}

	req, err := http.NewRequest("GET", publicNodesURL, nil)
	if err != nil {
		return cached
	}
	// The endpoint 403s the default Go user-agent.
	req.Header.Set("User-Agent", "ParallaxGUI/"+GUIVersion)
	resp, err := g.http.Do(req)
	if err != nil {
		return cached
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return cached
	}

	var body struct {
		Nodes []PublicNode `json:"nodes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return cached
	}
	g.publicMu.Lock()
	g.publicNodes = body.Nodes
	g.publicFetched = time.Now()
	g.publicMu.Unlock()
	return body.Nodes
}

// normalizeIP strips a "host:port" suffix and rejects loopback / private /
// unspecified addresses. Returns "" if the input isn't a usable public IP.
func normalizeIP(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// SplitHostPort handles bracketed IPv6 ("[::1]:8080") as well as plain
	// "1.2.3.4:5678". If the input is already a bare host it returns an
	// error, in which case we use it as-is.
	host, _, err := net.SplitHostPort(raw)
	if err != nil {
		host = raw
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return ""
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return ""
	}
	return ip.String()
}
