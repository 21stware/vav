// Package relays merges Tailcat's public DERP map with VAV's mainland relay.
// Hosts pick the lowest-latency region (China pin 锐驰; elsewhere pin Tailcat).
package relays

import (
	"context"
	"strings"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
)

// ChinaRegionID is outside Tailcat's 301–304 range.
const ChinaRegionID = 900

// FallbackDERPMapURL is Tailscale's map when tailcat.dev cannot be fetched.
const FallbackDERPMapURL = "https://login.tailscale.com/derpmap/default"

// Host is the compiled-in mainland DERP hostname (Shanghai 锐驰).
// Desktop can override at runtime with --derp-host / VAV_CN_DERP_HOST.
var Host = "derp.vavapp.com"

// ChinaRegion returns a single-node region for hostname, or nil if blank.
func ChinaRegion(host string) *tailcfg.DERPRegion {
	host = strings.TrimSpace(host)
	if host == "" {
		return nil
	}
	return &tailcfg.DERPRegion{
		RegionID:   ChinaRegionID,
		RegionCode: "cn",
		RegionName: "China",
		Nodes: []*tailcfg.DERPNode{{
			Name:     "900a",
			RegionID: ChinaRegionID,
			HostName: host,
		}},
	}
}

// IsStockTailcat reports whether region is a Tailcat/Tailscale public relay.
func IsStockTailcat(region *tailcfg.DERPRegion) bool {
	if region == nil {
		return false
	}
	if region.RegionID >= 301 && region.RegionID <= 399 {
		return true
	}
	for _, n := range region.Nodes {
		if n == nil {
			continue
		}
		h := strings.ToLower(n.HostName)
		if strings.Contains(h, "ipn.dev") || strings.Contains(h, "tailscale.com") {
			return true
		}
	}
	return false
}

// MergeChina adds the mainland region when a hostname is available.
func MergeChina(dm *tailcfg.DERPMap, host string) {
	if dm == nil {
		return
	}
	reg := ChinaRegion(firstHost(host))
	if reg == nil {
		return
	}
	if dm.Regions == nil {
		dm.Regions = map[int]*tailcfg.DERPRegion{}
	}
	dm.Regions[ChinaRegionID] = reg
}

func firstHost(host string) string {
	if h := strings.TrimSpace(host); h != "" {
		return h
	}
	return Host
}

// FetchMerged loads Tailcat's (or Tailscale's) public map and adds China.
func FetchMerged(ctx context.Context, host string, forServer bool) (*tailcfg.DERPMap, error) {
	opts := []any{}
	if forServer {
		opts = append(opts, tailcat.ExpandForServer)
	}
	dm, err := tailcat.FetchDERPMap(ctx, opts...)
	if err != nil {
		fb := append([]any{}, opts...)
		fb = append(fb, tailcat.DERPMapURL(FallbackDERPMapURL))
		dm, err = tailcat.FetchDERPMap(ctx, fb...)
		if err != nil {
			if firstHost(host) == "" {
				return nil, err
			}
			dm = &tailcfg.DERPMap{Regions: map[int]*tailcfg.DERPRegion{}}
		}
	}
	MergeChina(dm, host)
	return dm, nil
}

// AppendUnseen copies every region from dm onto ci that is not already listed.
func AppendUnseen(ci *tailcat.ConnInfo, dm *tailcfg.DERPMap) (extra int) {
	if ci == nil || dm == nil {
		return 0
	}
	seen := map[int]bool{}
	for _, reg := range ci.Region {
		if reg != nil {
			seen[reg.RegionID] = true
		}
	}
	for id, reg := range dm.Regions {
		if reg == nil || seen[id] {
			continue
		}
		ci.Region = append(ci.Region, reg)
		seen[id] = true
		extra++
	}
	return extra
}
