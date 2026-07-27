<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.png">
  <img src="docs/wordmark.png" alt="vav" height="54">
</picture>

<br/>
<!-- originai-release-badge:start -->
<a href="https://spec.getoriginai.com/feea5b82-31bd-4418-a57f-23bc4042e8ff/949953f85263bfa978f973ea3eea3d0445d0ae2046a427119ff126c6bd4ff373" target="_blank" rel="noopener noreferrer">
  <img src="https://spec.getoriginai.com/feea5b82-31bd-4418-a57f-23bc4042e8ff/949953f85263bfa978f973ea3eea3d0445d0ae2046a427119ff126c6bd4ff373/badge-dark.svg" alt="originai">
</a>
<!-- originai-release-badge:end -->



Local AI coding agent workstation. One window, three surfaces: chat, the file tree for the workspace this session is actually using, and a real terminal.

The agent isn’t narrating what it did — you watch it `cd`, run tests, and write files on the right. Everything stays on your machine except requests to the model endpoint you configure.

![vav](docs/screenshot.png)

## Features

- **Streaming chat** with collapsible reasoning, tool-call cards, expandable command output, and a context-usage panel
- **Five tools**: `terminal`, `fs_read`, `fs_write`, `fs_list`, plus `ask_user_question` / `request` that actually pause for your answer
- **Sticky shell**: every agent command runs in one long-lived shell, so `cd` and `export` persist
- **Real PTY tabs**: node-pty + xterm.js — `top` and `vim` work; the agent opens its own bash session on first command
- **File tree**: on-demand expand, agent edits highlighted, spacebar Quick Look; tree or column view
- **Per-session working directory**, defaulting to a temporary workspace you can point at a real project; `vav .` / `vav /path` CLI open
- **English / Chinese UI**, following the OS or a setting
- **Anthropic and OpenAI-compatible** APIs, with a customizable endpoint
- API keys stored encrypted via `safeStorage` (Keychain) — never as plaintext

## Website

The static site lives in [`site/`](site/) and is published to GitHub Pages by Actions:
https://21stware.github.io/vav/

Bilingual (toggle in the top-right; default follows the browser language). Marketing screenshots are captured with the English UI (chat / files / terminal / context):

```bash
node scripts/capture-marketing-screenshot.mjs
```

Writes `docs/screenshot.png` (README hero) and `site/assets/screenshot-*.png` (site gallery).

Custom domain: Settings → Pages → Custom domain, then configure DNS
(usually a `CNAME` to `21stware.github.io`, or A/ALIAS for apex).
After that, put the hostname in `site/CNAME` (one line, no scheme) and push so deploys don’t wipe the setting.

## Install

Grab a build from [Releases](https://github.com/21stware/vav/releases). Neither build is code-signed, so the OS will block the first open:

- **macOS (Apple silicon)** — after dragging into Applications, run
  `xattr -dr com.apple.quarantine /Applications/vav.app`, or Gatekeeper will claim the app is damaged.
- **Windows (x64)** — SmartScreen warns; choose “More info” → “Run anyway”.

Then in Settings → “vav command”, install the `vav` CLI (defaults to `~/.local/bin`). Run `vav -h` for usage; `vav .` opens a new session in the current directory.

## Develop

Requires Node 20+, macOS or Windows.

```bash
npm install
npm run dev
```

Package (native modules mean you only build for the platform you’re on):

```bash
npm run dist        # macOS → release/vav-1.1.0-macos-arm64.dmg
npm run dist:win    # Windows → release/vav-1.1.0-windows-x64-setup.exe
```

First launch asks for an API key (⌘, / Ctrl+,). File tree and terminal work before that; only agent turns need a key.

## Shortcuts

⌘ on macOS, Ctrl on Windows; in-app hints switch automatically.

| Action | Key |
| --- | --- |
| New session | ⌘N |
| Send | ⌘↩ |
| Cancel current turn | Esc |
| Search in session | ⌘F |
| New terminal tab | ⌘T |
| Toggle sidebar / tools panel | ⌘⇧H / ⌘⇧E |
| Settings | ⌘, |

A global hotkey can be recorded under Appearance; off by default.

## Platform differences

Most things match; these are OS differences, not missing features:

| | macOS | Windows |
| --- | --- | --- |
| Agent & terminal shell | zsh / bash / fish | PowerShell |
| Closing the main window | Hides; turns and PTYs keep running; Dock restores | Quits for real (no Dock to restore from) |
| Space in the file tree | Quick Look | Opens with the system default app |
| Default global hotkey | ⌃⌘Space | Ctrl+Alt+Space |

## Layout

```
src/
  shared/      domain types, IPC contracts, i18n
  main/
    store/     settings, secrets, conversation persistence
    agent/     LLM client, tool defs, turn loop
    terminal/  sticky shell, PTY management
    fs/        file listing and watchers
    cli.ts     `vav` command install and open-path parsing
  preload/     contextBridge `window.vav`
  renderer/    React UI, zustand stores, stream projection
```

Implementation notes: [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md). Product behavior is specified in RPML via Origin and pulled by `.agents/skills/origin-product-spec-management` into `.agents/specs/` (not checked in).

## License

Dual-licensed — see [NOTICE](NOTICE) and [LICENSE](LICENSE).

- **Noncommercial (free):** [PolyForm Noncommercial 1.0.0](LICENSE).
  Download, study, personal customization, and noncommercial redistribution are allowed; keep the `Required Notice` and upstream repo
  https://github.com/21stware/vav.
- **Commercial (paid):** Selling, white-labeling, embedding in a paid product/service, or any commercial customization / commercial use
  requires a **commercial license** from the copyright holder. Contact: licensing@21stware.com.
