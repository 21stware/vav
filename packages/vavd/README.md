# @21stware/vavd

Headless [VAV](https://github.com/21stware/vav). Run it on a machine that should host files, PTY, sessions, and agent turns without opening the desktop app.

```bash
npx @21stware/vavd
# or
npm i -g @21stware/vavd && vavd
# then, from another terminal:
vav send "hello"
```

Prints a pairing URI. Use it from:

- VAV desktop → Connect, or launch the app with `VAVD_URI` / `--vavd-uri` so it opens as a vavd UI. `VAVD_SPAWN=1` / `--with-vavd` starts this daemon as a child and pairs automatically.
- VAV Remote (iOS)
- the local web UI (`http://127.0.0.1:4752`)
- the Chrome extension side panel
- `npm run vav` in this repo (sessions / send / configure) — also reads `VAVD_URI`

All of those are the same control-plane client (`hello.role=phone`). Turns run in this process.

## Flags

```
vavd — headless VAV

  --port <n>          daemon / control listen port (default 4750)
  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)
  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)
  --web-listen <addr> web bind (default 127.0.0.1)
  --name <label>      machine name in pairing
  --state <dir>       identity + secrets + sessions (default ~/.vavd)
  --api-key <key>     VAV provider key (or VAV_API_KEY)
  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)
  --no-announce       skip LAN multicast
  --no-web            disable the web UI
```

Requires Node 22+. `node-pty` is installed as a dependency so spawned shells work on the host OS.

## License

Same as VAV: [PolyForm Noncommercial 1.0.0](https://github.com/21stware/vav/blob/main/LICENSE). Commercial use needs a license from 21stware.
