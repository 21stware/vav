---
name: computer-use
description: >
  Drive native desktop windows through VAV's embedded Cua Driver. Use when the
  user asks to click, type, verify, or launch a GUI app that has no useful CLI
  or API. Not for files, git, terminals, or ordinary web pages.
license: MIT
metadata:
  version: "1.0.0"
  category: computer-use
  source: vav
---

# Computer use (embedded Cua Driver)

VAV owns the driver. Do **not** install CuaDriver.app, do **not** spawn
`cua-driver --direct`, and do **not** start a second daemon.

- Built-in VAV: `computer_list` → `computer_observe` → `computer_act`.
- Cursor / Grok (ACP): use the already-attached `vav-computer` MCP
  (`list_apps` / `list_windows` / `get_window_state` / click / type).
  Prefer window-bound, background actions. The overlay cursor must not
  move the real pointer.

## Rules

1. Prefer `terminal`, `fs_*`, `web_fetch`, connectors, and officecli when they
   can finish the job. GUI is the fallback.
2. Bind every action to one `pid` + `window_id` from `computer_list`.
3. Call `computer_observe` on that window before click / type / key. Use
   `element_token` from the latest snapshot. `x,y` only for canvas / games.
4. Actions are **background only**. The real mouse stays put. Never request
   `activate`, desktop scope, or `delivery_mode: foreground`.
5. If a background action does not land, stop and tell the user. Do not retry
   by stealing focus.
6. `kind=launch` takes `bundle_id` only (Calculator, the app you just built).
7. Do not attach the user's daily browser profile. Web work stays on
   `web_fetch` / the browser the user already has.

## Loop

```
computer_list
computer_observe { pid, window_id }
computer_act { kind, pid, window_id, element_token }
computer_observe { pid, window_id }   # verify
```
