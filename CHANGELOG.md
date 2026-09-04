# Changelog

User-facing changes by release. Unreleased work lives at the top until the next `v*` tag.

## Unreleased

### Headless vavd

- Desktop can launch as a vavd UI with `VAVD_URI` / `--vavd-uri`, or spawn the daemon with `VAVD_SPAWN=1` / `--with-vavd`.
- GitHub Releases now attach the `@21stware/vavd` tarball and the Chrome extension zip, and fail if any required asset is missing.
- Packaged apps ship `vavd.js` so `--with-vavd` works without the git checkout.

## 1.18.12

Native menu icons, and bash tabs that stay independent when you split.

### Menus

- File keeps icons on New Session, Import, Export, and New Terminal.
- Session keeps icons on Send and Stop. Switch Model and Switch Permission Mode are submenus.
- Session context menus use Lucide glyphs; Archive stays text-only. Rows without an icon keep the same label column.

### Terminal

- ⌘T opens another bash tab. ⌘D / ⌘⇧D split the focused pane inside the current tab.
- Each tab keeps its own split tree, so switching chips no longer duplicates prompts.
- ⌘1–⌘9 focus the matching bash tab chip.

### Sidebar

- Pin and favorite stay in-flow so hover no longer shifts the sibling control.

## 1.18.11

TEMP DIR locate lands the `Workspace` folder in the chosen destination, and a paired host can disconnect or unpair one computer.

- Locate moves every child of `$TMPDIR/vav/<hex>` into the destination so it contains `Workspace` (no session-title rename, no `window.prompt`).
- Incoming pairing uses per-computer grants: Disconnect drops live sockets; Remove revokes the grant; Rotate pairing line invalidates the printed URI without kicking granted computers.

## 1.18.10

Keep desktop remote user turns after switching sessions, and stop the master from staying on running after the host finishes.

- Controller thread/turn frames write the user message into the local store and workbench events, so it is still there after leave and return.
- `turn:done` clears generating / session running instead of leaving the master stuck.

## 1.18.9

Let the phone pin and favorite sessions like the desktop sidebar.

- Remote session rows carry pin / favorite, sort pinned first, and accept those toggles on the remote-control wire.
- Older phones ignore the new fields.

## 1.18.8

File preview across every document kind, Grok ACP + session `/goal`, and audit hardening (stability, security, CI).

### File preview

- One preview kind across the workspace drawer, companion window, and File Session so every document type paints the same way.
- Picking Office, PDF, SQLite, media, or ZIP files no longer invents a line range in the agent prompt.

### Grok

- Session-scoped `/goal` banner (set / pause / resume / clear) for Grok Build.
- Grok ACP launch, model/effort, plan, and ask-user contracts match the real Grok CLI.

### Security

- Daemon listen defaults to loopback (`127.0.0.1`); LAN bind is explicit.
- Pairing secrets and host maps are written with mode `0o600`.
- File IPC and `vav-local://` refuse paths outside the watched workspace, app-managed temp dirs, and files granted by a native open/save dialog.
- Privileged IPC is limited to the app renderer’s main frame.
- Revealing stored API keys asks for confirmation in a native dialog.

### Reliability

- `unhandledRejection` is logged; daemon attach is disposed on quit.
- CLI stdio children escalate from SIGTERM to SIGKILL if they hang.
- Stream and shell buffers are capped; daemon reconnect uses backoff.
- Settings writes are debounced so bursty UI updates do not stall the main process.
- Local PTYs dispose ConPTY worker threads and pipe sockets on exit so Windows does not hang after a session ends.

### Tests / CI

- `npm test` globs `src/**/*.test.ts` (skips `*.live.test.ts` unless `TEST_LIVE=1`).
- CI runs unit tests on macOS and Windows before the build.
- Unit tests abort after 2 minutes; the CI job itself times out at 30 minutes.

### UI

- You / Agent role labels and cancelled-tool matching follow the locale catalog.
- Transcript, toasts, and error banners expose live regions for assistive tech.
- Empty sessions show a first-run checklist (API key, folder, first message).
- Finder-style file columns virtualize long directories.

## 1.18.7

Drive remote turns on the host so the controlled UI updates. See the GitHub Release notes for this tag.

## 1.18.6

See the GitHub Release notes for this tag.
