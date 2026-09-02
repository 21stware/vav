# Changelog

User-facing changes by release. Unreleased work lives at the top until the next `v*` tag.

## Unreleased

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

### Tests / CI

- `npm test` globs `src/**/*.test.ts` (skips `*.live.test.ts` unless `TEST_LIVE=1`).
- CI runs unit tests on macOS and Windows before the build.
- Unit tests abort after 2 minutes; the CI job itself times out at 30 minutes.

### UI

- You / Agent role labels and cancelled-tool matching follow the locale catalog.
- Transcript, toasts, and error banners expose live regions for assistive tech.
- Empty sessions show a first-run checklist (API key, folder, first message).
- Finder-style file columns virtualize long directories.

## 1.18.6

See the GitHub Release notes for this tag.
