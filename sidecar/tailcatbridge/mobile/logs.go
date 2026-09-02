package tcmobile

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

const maxLogLines = 500

var (
	logMu  sync.Mutex
	logBuf []string
)

// AppendLog records one diagnostic line. Safe from any goroutine.
func AppendLog(line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	stamp := time.Now().Format("15:04:05.000")
	logMu.Lock()
	defer logMu.Unlock()
	logBuf = append(logBuf, stamp+" "+line)
	if len(logBuf) > maxLogLines {
		logBuf = logBuf[len(logBuf)-maxLogLines:]
	}
}

// SnapshotLogs returns the in-memory tailcat / dial ring (newest last).
func SnapshotLogs() string {
	logMu.Lock()
	defer logMu.Unlock()
	return strings.Join(logBuf, "\n")
}

// ClearLogs drops the in-memory ring.
func ClearLogs() {
	logMu.Lock()
	defer logMu.Unlock()
	logBuf = nil
}

func logf(format string, args ...any) {
	AppendLog(fmt.Sprintf(format, args...))
}
