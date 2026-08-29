// Package tcmobile is the gomobile surface for the VAV Remote iOS app.
//
// It exposes exactly what the phone needs: dial a tailcat token, then read
// and write JSON lines. Protocol logic (hello/auth, message shapes) lives in
// Swift beside the UI; reconnection policy lives there too, so this layer
// stays a blocking pipe that Swift wraps in async tasks.
package tcmobile

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/types/logger"
)

// bridgePort mirrors the sidecar's tunnel-side listening port.
const bridgePort = 4747

// Session is one live tunnel connection to the Mac.
type Session struct {
	client *tailcat.Client
	conn   net.Conn
	reader *bufio.Reader
}

// Dial parses a connection token (from the pairing QR) and opens the bridge
// stream. Off-LAN the path is DERP: the QR only embeds the Mac's home
// region, so we merge the public map when reachable — otherwise 5G that
// cannot hit that one node never finds the Mac. Blocks up to 45s.
func Dial(token string) (*Session, error) {
	blob, err := enrichBlob(strings.TrimSpace(token))
	if err != nil {
		return nil, err
	}
	cl := tailcat.NewClient(blob)
	cl.Logf = logger.Discard
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			cl.Close()
			return nil, fmt.Errorf("中继超时：5G 需经公网中继连电脑。请确认电脑开着且 VAV 在跑")
		}
		conn, err := cl.DialTCPPort(ctx, bridgePort)
		if err == nil {
			return &Session{
				client: cl,
				conn:   conn,
				reader: bufio.NewReaderSize(conn, 64*1024),
			}, nil
		}
		last = err
		time.Sleep(time.Duration(attempt+1) * 400 * time.Millisecond)
	}
	cl.Close()
	return nil, fmt.Errorf("连不上电脑：%v", last)
}

// enrichBlob copies every public DERP region into the token so magicsock
// can pick a relay the phone can actually reach. The QR stays small
// (home region only); this expansion is in-memory on the phone.
func enrichBlob(token string) (tailcat.ConnBlob, error) {
	raw := tailcat.ConnBlob(token)
	ci, err := tailcat.ParseConnBlob(raw)
	if err != nil {
		return "", fmt.Errorf("配对令牌无效：%w", err)
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

// WriteLine sends one protocol frame. The caller passes complete JSON;
// the trailing newline is appended here.
func (s *Session) WriteLine(line string) error {
	_, err := s.conn.Write(append([]byte(line), '\n'))
	return err
}

// ReadLine blocks until the next frame (without the newline) or an error.
// Call from a background task; an error means the session is dead.
func (s *Session) ReadLine() (string, error) {
	line, err := s.reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(line, "\n"), nil
}

// Close tears down the stream and the WireGuard engine.
func (s *Session) Close() {
	s.conn.Close()
	s.client.Close()
}
