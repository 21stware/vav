# @21stware/vavd

Headless [VAV](https://github.com/21stware/vav) workspace-host daemon. Run it on a machine that should host files, PTY, and agent turns without opening the desktop app. Pair from another VAV → **Settings → Allow other devices**.

```bash
npx @21stware/vavd
```

Prints a pairing line on stdout. Paste that line in VAV to attach.

## Flags

```
vavd — VAV workspace-host daemon

  --port <n>       listen port (default 4750)
  --listen <addr>  bind address (default 0.0.0.0)
  --name <label>  machine name in pairing
  --state <dir>    identity + secret dir (default ~/.vavd)
  --no-announce    skip LAN multicast
```

Requires Node 22+. `node-pty` is installed as a dependency so spawned shells work on the host OS.

## License

Same as VAV: [PolyForm Noncommercial 1.0.0](https://github.com/21stware/vav/blob/main/LICENSE). Commercial use needs a license from 21stware.
