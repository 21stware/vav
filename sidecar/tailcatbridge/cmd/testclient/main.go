// testclient dials a tailcatbridge token and pipes stdin/stdout through the
// tunnel — a minimal stand-in for the iOS app, useful for manual testing:
//
//	go run ./cmd/testclient <token>
package main

import (
	"context"
	"io"
	"log"
	"os"

	"github.com/tailscale/tailcat"
	"tailscale.com/types/logger"
)

const bridgePort = 4747

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: testclient <token>")
	}
	cl := tailcat.NewClient(tailcat.ConnBlob(os.Args[1]))
	cl.Logf = logger.Discard
	defer cl.Close()

	c, err := cl.DialTCPPort(context.Background(), bridgePort)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	go func() {
		io.Copy(c, os.Stdin)
		c.Close()
	}()
	io.Copy(os.Stdout, c)
}
