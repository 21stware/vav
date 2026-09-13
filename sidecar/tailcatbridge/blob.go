package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/21stware/vav/sidecar/tailcatbridge/relays"
	"github.com/tailscale/tailcat"
)

// enrichBlob copies every public DERP region (plus the mainland relay) into
// the token so magicsock can pick a relay the client can actually reach.
func enrichBlob(token, extraHost string) (tailcat.ConnBlob, error) {
	raw := tailcat.ConnBlob(strings.TrimSpace(token))
	ci, err := tailcat.ParseConnBlob(raw)
	if err != nil {
		return "", fmt.Errorf("invalid pairing token: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	dm, err := relays.FetchMerged(ctx, extraHost, false)
	if err != nil || dm == nil || len(dm.Regions) == 0 {
		return raw, nil
	}
	relays.AppendUnseen(&ci, dm)
	return ci.ConnBlob(), nil
}
