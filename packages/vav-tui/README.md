# @21stware/vav-tui

Claude Code-style agent CLI for a running [vav-server](https://github.com/21stware/vav/tree/main/packages/vav-server). Turns run in the daemon; desktop / phone / Chrome see the same session.

```bash
npx @21stware/vav-tui
npx @21stware/vav-tui -p "hello"
npx @21stware/vav-tui --mode json -p "hello"
npx @21stware/vav-tui --mode rpc    # JSON lines on stdin: prompt / cancel / quit
npx @21stware/vav-tui -c
```

Interactive slash commands (same tokens work as one-shot argv, e.g. `vav-tui /files`): `/help` `/new` `/session` `/thread` `/model` `/cwd` `/approval` `/permissions` `/thinking` `/files` `/file` (including `/file mkdir` / `rename` / `rm`) `/review` `/git` `/diff` `/github` (including `/github pull` / `run`) `/timers` (including `/timers create` / `update` / `get` / `run` / `remove`) `/status` `/export` `/cost` `/init` `/compact` `/duplicate` `/pin` `/rename` `/regenerate` `/fork` `/reply` `/edit` `/continue` `/goal` `/locate` `/leaf` `/delete` `/account` (including `/account oauth` / `cancel` / `signout` / `update` / `current` / `verify` / `reveal`) `/connectors` (including `/connectors auth` / `status` / `act`) `/logs` (including `/logs stats` / `clear` / `export` / `record` / `tail`) `/file-session` `/settings` `/quit`. RPC (`--mode rpc`) also accepts `prompt` / `reply` / `edit` / `continue` / `cancel` / `quit` JSON lines.

Bins: `vav-tui` and `vav-tui`. Also `npm run vav-tui` from this repo.
