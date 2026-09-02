package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"os"
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
//
// A probe dial must succeed before ready, then that conn is closed. Each
// Accept opens a fresh remote stream — holding the probe would leave a
// dead pipe after idle (local listen stays up, hello never returns).
func runDial(token string, verbose bool) {
	logf := logger.Discard
	if verbose {
		logf = log.Printf
	}
	blob, err := enrichBlob(token)
	if err != nil {
		blob = tailcat.ConnBlob(token)
	}

	newClient := func() *tailcat.Client {
		cl := tailcat.NewClient(blob)
		cl.Logf = logf
		return cl
	}

	var mu sync.Mutex
	cl := newClient()
	defer func() {
		mu.Lock()
		cl.Close()
		mu.Unlock()
	}()

	dialRemote := func() (net.Conn, error) {
		ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
		defer cancel()
		mu.Lock()
		client := cl
		mu.Unlock()
		conn, err := client.DialTCPPort(ctx, bridgePort)
		if err == nil {
			return conn, nil
		}
		mu.Lock()
		cl.Close()
		cl = newClient()
		client = cl
		mu.Unlock()
		ctx2, cancel2 := context.WithTimeout(context.Background(), dialTimeout)
		defer cancel2()
		return client.DialTCPPort(ctx2, bridgePort)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		log.Fatalf("listen: not tcp")
	}

	probe, err := dialRemote()
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	_ = probe.Close()

	if err := json.NewEncoder(os.Stdout).Encode(readyEvent{Event: "ready", Port: tcpAddr.Port}); err != nil {
		log.Fatalf("write ready: %v", err)
	}

	go func() {
		for {
			local, err := ln.Accept()
			if err != nil {
				return
			}
			go func(local net.Conn) {
				remote, err := dialRemote()
				if err != nil {
					log.Printf("redial: %v", err)
					local.Close()
					return
				}
				tailcat.ProxyConns(local, remote)
			}(local)
		}
	}()

	io.Copy(io.Discard, os.Stdin)
}
