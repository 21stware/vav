# Bundled binaries

## officecli

[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0) — AI-oriented CLI for `.docx` / `.xlsx` / `.pptx`.

Binaries are **not** committed. Fetch the pinned release before `dev` / `dist`:

```bash
node scripts/fetch-officecli.mjs
# or: npm run fetch:officecli
```

Version pin: `scripts/fetch-officecli.mjs` (`OFFICECLI_VERSION` env overrides).

At runtime VAV prepends this directory to the agent shell `PATH` so `officecli` resolves without a system install.

## vav_screencap.node

macOS-only N-API addon (not committed). Built by `scripts/build-mac-screencap.mjs` during `npm run dev` / `npm run build`. Snapshots displays with CoreGraphics as they appear — VAV windows stay on screen and in the shot. Overlay panels use content protection so they are not captured.
