# @21stware/vav-server

Headless [VAV](https://github.com/21stware/vav). Run it on a machine that should host files, PTY, sessions, and agent turns without opening the desktop app.

```bash
npx @21stware/vav-server
# or
npm i -g @21stware/vav-server && vav-server
# or the 21stware-vav-server-*.tgz on each GitHub Release
```

Prints a pairing URI. Use it from:

- VAV desktop → Connect, or launch the app with `VAV_SERVER_URI` / `--vav-server-uri` so it opens as a vav-server UI. Packaged builds and `npm run dev` spawn this daemon as a child and pair automatically.
- the local web UI (`http://127.0.0.1:4752`) — discovers and pairs on loopback

Turns run in this process.

## Flags

```
vav-server — headless VAV

  --port <n>          daemon / control listen port (default 4750)
  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)
  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)
  --web-listen <addr> web bind (default 127.0.0.1)
  --name <label>      machine name in pairing
  --state <dir>       identity + secrets + sessions (default ~/.vav-server)
  --api-key <key>     VAV provider key (or VAV_API_KEY)
  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)
  --no-announce       skip LAN multicast
```
