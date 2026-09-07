# @21stware/vav-cli

Claude Code-style agent CLI for a running [vavd](https://github.com/21stware/vav/tree/main/packages/vavd). Turns run in the daemon; desktop / phone / Chrome see the same session.

```bash
npx @21stware/vav-cli
npx @21stware/vav-cli -p "hello"
npx @21stware/vav-cli --mode json -p "hello"
npx @21stware/vav-cli --mode rpc    # JSON lines on stdin: prompt / cancel / quit
npx @21stware/vav-cli -c
```

Interactive slash commands (same tokens work as one-shot argv, e.g. `vavcli /files`): `/help` `/new` `/session` `/thread` `/model` `/cwd` `/approval` `/permissions` `/thinking` `/files` `/file` (including `/file mkdir` / `rename` / `rm`) `/review` `/git` `/diff` `/github` (including `/github pull` / `run`) `/timers` (including `/timers create` / `update` / `get` / `run` / `remove`) `/status` `/export` `/cost` `/init` `/compact` `/duplicate` `/pin` `/rename` `/regenerate` `/fork` `/reply` `/edit` `/continue` `/goal` `/locate` `/leaf` `/delete` `/account` (including `/account oauth` / `cancel` / `signout` / `update` / `current` / `verify` / `reveal`) `/connectors` (including `/connectors auth` / `status` / `act`) `/logs` (including `/logs stats` / `clear` / `export` / `record` / `tail`) `/file-session` `/settings` `/quit`. RPC (`--mode rpc`) also accepts `prompt` / `reply` / `edit` / `continue` / `cancel` / `quit` JSON lines.

Bins: `vav-cli` and `vavcli`. Also `npm run vavcli` from this repo.
