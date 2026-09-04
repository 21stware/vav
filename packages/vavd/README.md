# @21stware/vavd

Headless [VAV](https://github.com/21stware/vav). Run it on a machine that should host files, PTY, sessions, and agent turns without opening the desktop app.

```bash
npx @21stware/vavd
# or
npm i -g @21stware/vavd && vavd
# or the 21stware-vavd-*.tgz on each GitHub Release
# then, from another terminal:
vav send "hello"
```

Prints a pairing URI. Use it from:

- VAV desktop → Connect, or launch the app with `VAVD_URI` / `--vavd-uri` so it opens as a vavd UI. `VAVD_SPAWN=1` / `--with-vavd` starts this daemon as a child and pairs automatically.
- VAV Remote (iOS)
- the local web UI (`http://127.0.0.1:4752`) — paste the URI or the secret
- the Chrome extension side panel
- `npm run vav` in this repo (sessions / send / configure / cancel) — also reads `VAVD_URI`

All of those are the same control-plane client (`hello.role=phone`). Turns run in this process.

## Flags

```
vavd — headless VAV

  --port <n>          daemon / control listen port (default 4750; 0 = ephemeral)
  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)
  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)
  --web-listen <addr> web bind (default 127.0.0.1)
  --name <label>      machine name in pairing
  --state <dir>       identity + secrets + sessions (default ~/.vavd)
  --api-key <key>     VAV provider key (or VAV_API_KEY)
  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)
  --no-announce       skip LAN multicast
  --no-web            disable the web UI
  --quiet             print only the pairing URI
  --version, -V       print version
  --help, -h          this help

  clients          list authorized computers
  disconnect <id>  drop live sockets; grant remains
  unpair <id>      revoke a computer’s grant
  rotate-offer     invalidate the printed pairing URI; existing grants stay
```

`--port` / `--web-port` must be integers `0–65535`. Invalid values exit with an error instead of silently using the default. `--flag=value` works the same as `--flag value`.

`vavd rotate-offer` against a running daemon prints the new pairing URI. If `vavd` is not running, it rotates `secret.json` on disk.

## `vav` CLI

```
vav sessions
vav create
vav send <text> [--session <id>]
vav thread [--session <id>]
vav configure --session <id> [--model <id>] [--approval auto|bypass|edit] [--thinking off|low|medium|high]
vav cancel --session <id>
vav reply --session <id> --tool <id> --answer <text>

  --uri vav-daemon://…   pairing URI (or VAVD_URI)
  --host --port --secret override pieces
  --state <dir>          read secret.json (default ~/.vavd)
```

If vavd is not listening, the CLI says so instead of dumping a raw `ECONNREFUSED`.

Requires Node 22+. `node-pty` is installed as a dependency so spawned shells work on the host OS.

## License

Same as VAV: [PolyForm Noncommercial 1.0.0](https://github.com/21stware/vav/blob/main/LICENSE). Commercial use needs a license from 21stware.
