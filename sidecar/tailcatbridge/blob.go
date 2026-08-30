package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/tailscale/tailcat"
)

// enrichBlob copies every public DERP region into the token so magicsock
// can pick a relay the client can actually reach. The pairing payload
// stays small (home region only); this expansion is in-memory.
func enrichBlob(token string) (tailcat.ConnBlob, error) {
	raw := tailcat.ConnBlob(strings.TrimSpace(token))
	ci, err := tailcat.ParseConnBlob(raw)
	if err != nil {
		return "", fmt.Errorf("invalid pairing token: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	dm, err := tailcat.FetchDERPMap(ctx)
	if err != nil || dm == nil || len(dm.Regions) == 0 {
		return raw, nil
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
	}
	return ci.ConnBlob(), nil
}
