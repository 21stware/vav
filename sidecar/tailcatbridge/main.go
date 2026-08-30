// tailcatbridge is VAV's remote-control transport sidecar.
//
// It runs a tailcat listener (Tailscale data plane, no control plane) with a
// persistent node key, and forwards every inbound tunnel TCP connection to a
// local TCP address where VAV's Electron main process speaks the JSON-lines
// remote-control protocol. All protocol logic lives on the TypeScript side;
// this binary is a dumb encrypted pipe.
//
// Startup output (stdout, one JSON object per line):
//
//	{"event":"ready","token":"tc..."}
//
// The token is stable across restarts: the node key and DERP region are
// pinned in the key file on first run (like `tailcat genkey`).
//
// The process exits when stdin reaches EOF, so it can never outlive Electron.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/types/logger"
)

// bridgePort is the tunnel-side TCP port clients dial (any fixed value works;
// it only has meaning inside the WireGuard tunnel).
const bridgePort = 4747

// fallbackDERPMapURL is Tailscale's main DERP map, used when the tailcat map
// can't be fetched (e.g. resolvers that fail on tailcat.dev).
const fallbackDERPMapURL = "https://login.tailscale.com/derpmap/default"

// keyFile pins both the node key and the full DERP region, so restarts need
// no network fetch and the connection token never changes.
type keyFile struct {
	PrivateKey key.NodePrivate     `json:"privateKey"`
	Region     *tailcfg.DERPRegion `json:"region"`
}

type readyEvent struct {
	Event string `json:"event"`
	Token string `json:"token,omitempty"`
	Port  int    `json:"port,omitempty"`
}

func main() {
	keyPath := flag.String("key-file", "", "path to the persistent key file (created on first run)")
	forward := flag.String("forward", "", "local TCP address to forward tunnel connections to (host:port)")
	dial := flag.String("dial", "", "tailcat connection token; client mode for desktop pairing")
	verbose := flag.Bool("verbose", false, "log tailcat internals to stderr")
	flag.Parse()

	if *dial != "" {
		runDial(*dial, *verbose)
		return
	}

	if *keyPath == "" || *forward == "" {
		fmt.Fprintln(os.Stderr, "usage: tailcatbridge --key-file <path> --forward <host:port>")
		fmt.Fprintln(os.Stderr, "       tailcatbridge --dial <token>")
		os.Exit(2)
	}
	log.SetOutput(os.Stderr)

	kf, err := loadOrCreateKey(*keyPath)
	if err != nil {
		log.Fatalf("key file: %v", err)
	}

	logf := logger.Discard
	if *verbose {
		logf = log.Printf
	}
	srv := &tailcat.Server{
		Key:    kf.PrivateKey,
		Region: kf.Region,
		Logf:   logf,
		OnTCP: func(port uint16) func(net.Conn) {
			if port != bridgePort {
				return nil
			}
			return func(c net.Conn) {
				local, err := net.DialTimeout("tcp", *forward, 10*time.Second)
				if err != nil {
					log.Printf("forward dial %s: %v", *forward, err)
					c.Close()
					return
				}
				tailcat.ProxyConns(c, local)
			}
		},
	}
	if err := srv.Start(); err != nil {
		log.Fatalf("tailcat start: %v", err)
	}
	waitDERP(srv, 15*time.Second)

	if err := json.NewEncoder(os.Stdout).Encode(readyEvent{Event: "ready", Token: string(srv.ConnBlob())}); err != nil {
		log.Fatalf("write ready: %v", err)
	}

	// Exit when the parent (Electron) closes our stdin.
	io.Copy(io.Discard, os.Stdin)
	srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	srv.DrainTCP(ctx)
}

// loadOrCreateKey reads the persistent identity, or creates one pinning the
// lowest-latency DERP region so the connection token never changes.
func loadOrCreateKey(path string) (*keyFile, error) {
	if data, err := os.ReadFile(path); err == nil {
		var kf keyFile
		if err := json.Unmarshal(data, &kf); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		if kf.PrivateKey.IsZero() || kf.Region == nil {
			return nil, fmt.Errorf("%s: missing key or region", path)
		}
		return &kf, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	dm, err := tailcat.FetchDERPMap(ctx, tailcat.ExpandForServer)
	if err != nil {
		log.Printf("tailcat DERP map unavailable (%v); trying fallback", err)
		dm, err = tailcat.FetchDERPMap(ctx, tailcat.ExpandForServer, tailcat.DERPMapURL(fallbackDERPMapURL))
		if err != nil {
			return nil, fmt.Errorf("fetch DERP map: %w", err)
		}
	}
	regionID, err := tailcat.PickBestRegion(ctx, dm)
	if err != nil {
		return nil, fmt.Errorf("pick DERP region: %w", err)
	}
	region, ok := dm.Regions[regionID]
	if !ok || region == nil {
		return nil, fmt.Errorf("no reachable DERP region")
	}

	kf := &keyFile{PrivateKey: key.NewNode(), Region: region}
	data, err := json.MarshalIndent(kf, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return nil, err
	}
	return kf, nil
}

func waitDERP(srv *tailcat.Server, d time.Duration) {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		st := srv.Status()
		if st != nil && st.Self != nil && st.Self.Relay != "" {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}
