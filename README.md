<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.png">
  <img src="docs/wordmark.png" alt="vav" height="40">
</picture>

<br/>

<!-- originai-release-badge:start -->
<a href="https://spec.getoriginai.com/feea5b82-31bd-4418-a57f-23bc4042e8ff/fc132f32d1d4142967a3db9ec649cf9679c27351e1b44d6d59370ccb60b19b46" target="_blank" rel="noopener noreferrer"><img src="https://spec.getoriginai.com/feea5b82-31bd-4418-a57f-23bc4042e8ff/fc132f32d1d4142967a3db9ec649cf9679c27351e1b44d6d59370ccb60b19b46/badge-dark.svg" alt="OriginAI" /></a>
<!-- originai-release-badge:end -->



**Your agents' workbench.** Open a folder or a document, see it, pick a block, and ask — with the built-in VAV agent or Claude Code / Codex in the same thread. Writes land on disk and you accept or reject them. A real terminal sits beside the chat. Everything stays on your machine; each CLI agent manages its own auth.

New session: pick a workspace, pick an agent, ask one thing. Multi-split CLI TUIs (Swarm) are an optional advanced mode under Settings → Providers.

![vav](docs/screenshot.png)

## Features

- **File workbench** — tree / columns, format-aware preview (Office, PDF, Markdown, CSV, code, …), pick a block and ask beside the file
- **Built-in VAV chat** — Anthropic-, OpenAI-, or Google-native API (model metadata and live model lists come from the provider); image attachments reach vision models inline; tools write to the session folder; accept / reject the diff
- **CLI in the same thread** — Claude Code, Pi, Cursor, Devin, Antigravity, Codex, Grok, Kiro, OpenCode, and Cline over their structured protocol (install from Settings if the binary is missing)
- **User PTY** (⌘T) — real bash / zsh / PowerShell; `top` and `vim` work
- **Per-session working directory**, defaulting to a temporary workspace you can point at a real project; `vav .` / `vav /path` CLI open
- **Git change inspector** — status + diff in the Files tray; commit stays in the terminal or the agent
- **English / Chinese UI**, following the OS or a setting
- API keys stored encrypted via `safeStorage` (Keychain) — never as plaintext
- **Spending** — Settings panel for local usage plus provider subscriptions, and DeepSeek API balance when VAV talks to official DeepSeek
- **Swarm** (optional) — multi-split raw CLI TUIs; off by default in Settings → Providers
- **Remote** — Settings → Allow other devices; pair VAV Remote (iOS) or another computer. Conversations and keys stay on this machine
- **Headless VAV** — `npx @21stware/vavd` (or `npm i -g @21stware/vavd && vavd`) hosts sessions, keys, files, PTY, and agent turns. Desktop, iOS Remote, the local web UI, and the Chrome extension are shells over that daemon.

## Website

The static site lives in [`site/`](site/) and is published to GitHub Pages by Actions:

https://vavapp.com  
(also https://21stware.github.io/vav/)

Bilingual (toggle in the top-right; default follows the browser language, and `?lang=zh` pins it). Marketing screenshots are captured in English, light and dark:

```bash
node scripts/capture-marketing-screenshot.mjs
```

Writes `docs/screenshot.png` (README hero) and `site/assets/screenshot-*.png` (site gallery), then
derives the AVIF/WebP variants the site actually serves. The PNGs stay as the `<picture>` fallback.
If you edit `site/assets/*.png` by hand, regenerate the variants or visitors keep the old ones:

```bash
npm run site:images        # add -- --force to rebuild everything
npm run brand:icons        # rebuild Windows .ico + site favicon from build/icon.png
```

Custom domain: `vavapp.com` (see `site/CNAME`). Apex uses GitHub Pages `A`/`AAAA` records; `www` is a `CNAME` to `21stware.github.io`. Keep Cloudflare proxy **DNS only** (grey cloud) so GitHub can issue HTTPS.

## Install

Grab a build from [Releases](https://github.com/21stware/vav/releases).

- **macOS** — Developer ID signed and notarized (app + DMG, ticket stapled); open the DMG and drag to Applications. Later versions update in-app (About → Check for Updates).
- **Windows** — not code-signed; SmartScreen may warn on first open (More info → Run anyway). In-app updates use the NSIS installer feed.

Then in Settings → “vav command”, install the `vav` CLI (defaults to `~/.local/bin`). Run `vav -h` for usage; `vav .` opens a new session in the current directory.

On a machine that should host VAV without opening the desktop app:

```bash
npx @21stware/vavd
# or: npm i -g @21stware/vavd && vavd
```

Listens on all interfaces by default (`--listen 127.0.0.1` for local-only). Opens a web UI on `http://127.0.0.1:4752`. Paste the pairing line into VAV → Connect, VAV Remote, the web UI, or the Chrome extension — or launch the desktop app with `VAVD_URI` / `--vavd-uri` so it opens as a vavd UI without the Connect paste. `VAVD_SPAWN=1` / `--with-vavd` starts vavd as a child of the app and pairs automatically. The pairing secret is equivalent to local access on that machine. Set `VAV_API_KEY` (and optional `VAV_API_ENDPOINT`) so the daemon can call your model.

From this repo, `npm run vav -- sessions` / `npm run vav -- send "hello"` talks to that daemon over the same phone protocol.

## Develop

Requires Node 22+, macOS or Windows.

```bash
npm install
npm run dev         # auto-fetches bundled officecli into resources/bin/ if missing
```

`officecli` (Office OOXML CLI) is vendored at build time (~32 MB) via `npm run fetch:officecli` and shipped in the app `Resources/bin` so the agent can create/edit `.docx`/`.xlsx`/`.pptx` without a system install.

Package (native modules mean you only build for the platform you’re on):

```bash
npm run dist        # macOS → release/vav-*-macos-arm64.dmg (signed + notarized when credentials are set)
npm run dist:win    # Windows → release/vav-*-windows-x64-setup.exe
```

First launch unlocks the Keychain store. File tree and terminal work immediately. The built-in VAV agent needs an API key (⌘, / Ctrl+,); Claude / Codex use their own login.

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
