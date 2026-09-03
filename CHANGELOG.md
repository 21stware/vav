# Changelog

User-facing changes by release. Unreleased work lives at the top until the next `v*` tag.

## Unreleased

- Desktop remote: a user turn from the controller stays after switching sessions, and the master stops showing running once the host turn finishes.

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
