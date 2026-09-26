---
name: observe-desktop-ui
description: >-
  Observe the VAV desktop workbench in a real browser (ego-browser / Chrome)
  instead of Electron. Prefer the live observe proxy when Electron is running
  so sessions, files, settings, PTY, and agent IPC are real. Use fixture
  scenes only when Electron is down. Triggers: desktop renderer UI, layout,
  CSS, sidebar, home, session, settings, ego observe, web preview.
---

# Observe the desktop UI

The workbench renderer is an Electron window. Cursor's browser tools and
ego-browser cannot attach to that process. Do **not** screenshot the Electron
app or guess from CSS.

## Fast path — live observe (ego)

Electron already running (`npm run dev`) exposes a localhost proxy:

```text
http://127.0.0.1:5175/
```

That URL is the **same desktop renderer** with `window.vav` forwarded to the
real Electron IPC / vav-server. ego-browser can `openOrReuseTab` this origin
and use `snapshotText` / `click` / `js` as on any website.

```bash
npm run dev
```

Then in ego:

```js
const task = await useOrCreateTaskSpace('vav desktop observe')
await openOrReuseTab('http://127.0.0.1:5175/', { wait: true, timeout: 30 })
cliLog(await snapshotText())
```

Badge **live observe** means the page is talking to Electron. `?view=settings`
opens Settings in the same tab. Context menus are a DOM popover so ego can
click them.

`?fixture=1` forces the offline fixture even when Electron is up.

## Offline fixture

When Electron is not running:

```bash
npm run dev:web
```

`http://127.0.0.1:5174/` paints chrome with fixture sessions.

| URL | What you see |
| --- | --- |
| `/` or `?scene=chat` | Sidebar + fixture transcript |
| `?scene=home` | Workbench home |
| `?scene=empty` | First-run, no API key |
| `?view=settings` | Settings window |
| `?theme=dark` / `?theme=light` | Force appearance |

If `npm run dev` is also up, `dev:web` (and the Vite renderer URL) attach to
the same live IPC proxy. Add `?fixture=1` to keep the fake data.

## What to do after a UI change

1. Prefer `http://127.0.0.1:5175/` with Electron running.
2. Exercise the control (click, type, resize, open a menu) — a static
   screenshot is not enough.
3. Check the other surfaces that share the store or CSS you touched
   (home, session, settings).
4. Live observe is chrome **and** service truth for this machine. Native
   file pickers / vibrancy still belong to the Electron window.

## Do not

- Tell the user to "just open the Electron window" as the only verification.
- Edit `src/web-ui` when the change is the loopback web shell.
- Expect fixture mode (`?fixture=1` / no Electron) to run PTY, keychain, or a live agent.
