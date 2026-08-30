package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/types/logger"
)

const dialTimeout = 45 * time.Second

// runDial is the desktop pair client: open the remote bridge over tailcat
// and expose it on 127.0.0.1 so Electron can speak the daemon protocol.
//
// Startup stdout: {"event":"ready","port":N}
// The process exits when stdin reaches EOF (parent died).
func runDial(token string, verbose bool) {
	logf := logger.Discard
	if verbose {
		logf = log.Printf
	}
	cl := tailcat.NewClient(tailcat.ConnBlob(strings.TrimSpace(token)))
	cl.Logf = logf
	defer cl.Close()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		log.Fatalf("listen: not tcp")
	}

	var remote net.Conn
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
		remote, last = cl.DialTCPPort(ctx, bridgePort)
		cancel()
		if last == nil {
			break
		}
		log.Printf("dial attempt %d: %v", attempt+1, last)
		time.Sleep(time.Duration(attempt+1) * 400 * time.Millisecond)
	}
	if last != nil {
		log.Fatalf("dial: %v", last)
	}

	if err := json.NewEncoder(os.Stdout).Encode(readyEvent{Event: "ready", Port: tcpAddr.Port}); err != nil {
		log.Fatalf("write ready: %v", err)
	}

	var mu sync.Mutex
	pending := remote

	go func() {
		for {
			local, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conn := pending
			pending = nil
			mu.Unlock()
			if conn == nil {
				dctx, dcancel := context.WithTimeout(context.Background(), dialTimeout)
				conn, err = cl.DialTCPPort(dctx, bridgePort)
				dcancel()
				if err != nil {
					log.Printf("redial: %v", err)
					local.Close()
					continue
				}
			}
			go tailcat.ProxyConns(local, conn)
		}
	}()

	io.Copy(io.Discard, os.Stdin)
}
