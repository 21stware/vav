# Changelog

User-facing changes by release. Unreleased work lives at the top until the next `v*` tag.

## Unreleased

## 1.22.0

Artifacts are opt-in: only files the agent marks with `<!-- vav-artifact -->` or `artifact: true` on `fs_write` appear in the Files tray Artifacts tab (the tools panel shows a count). Ordinary source edits and Change Review files stay out. Screenshot Esc cancels even before the overlay is up. Sidebar hide keeps the column mounted, and macOS glass is re-asserted without tearing the native layer down. Removing the last VAV API key no longer resurrects a DeepSeek row from the leftover `api` slot.

## 1.21.0

`vavd` / `vavc` / `vavcli` are now `vav-server` / `vav-board` / `vav-tui` (old names stay as aliases). `vav-server` has docker-style named profiles under `~/.vav/servers/<name>` (`ls` / `create` / `start` / `stop` / `rm`). Desktop LAN pair confirm, host unpair, and third-party session sync talk to the spawned vav-server. The sidebar instance chip owns the session menu — chevron on the right, no light/dark toggles, Settings opens for that instance. Missing Screen Recording permission shows a dialog that opens macOS System Settings. `bun run dev:vav-server` (and `dev:vav-board` / `dev:vav-tui`) runs the CLIs without Node 22.

## 1.20.0

Settings follow the sidebar accordion: providers and host prefs belong to the active vav-server; appearance is a local per-connection overlay that inherits that host's theme, tint, accent, and pattern without writing back. Pairing lives in Settings → Connect — the standalone Connect window is gone.

Daemon pairing URIs are `vavrtp://`. The desktop no longer opens a second window for the spawned local vav-server — that process is the default service. Connecting another machine switches the same sidebar (horizontal accordion of services) instead of opening a host window or minting a chat. Each connection can have its own theme. About shows both VAV and vav-server versions.

`@21stware/vav-server` now ships `vav-board` (herdr-style control client) and `vav-tui` (pi-style agent CLI) beside `vav-server`. Settings → Command Line installs all three plus the desktop `vav` opener. They share the same phone protocol and pairing as the app, web UI, and Chrome extension.

Cursor ACP sessions no longer die on startup when Grok (or another family) is selected. Connectors and Timers are separate product surfaces. Conversations list the files the agent produced under the thread. Files in the workbench drag out as real OS files (browser, TextEdit, Finder). Settings → Logs is the local vav-server diagnostic sink (user / agent / system), with temporary / session / durable retention. The desktop shell queries that store over the daemon; it does not keep a second copy. The Files tray has a Plugins tab for global skills, MCP servers, and hooks.

### CLI

- Headless vav-server keeps `pty.spawn` and `process.spawn` on the daemon after the client socket closes, so `vav-board pane spawn` / `write` / `kill` and a later `process.write` / `kill` work as separate commands (the same lifetime as a desktop New bash tab or Git spawn).
- `vav-board` is the herdr-style control client: sessions (including pin / star / reply / compact / duplicate / continue / regenerate / edit / fork / goal), workspaces (including browse / recents), agents, **files** (`list` / `stat` / `read` / `write` / `mkdir` / `rename` / `rm` / `exists` / `reveal` / `open` / `info`), **file-session** (`open` / `create` / `list` / `activate` / `rename` / `delete` / `force-delete` / `readonly`), **panes** (`spawn` / `write` / `kill` / `run`), **review** (`seed` / `active` / `get` / `accept` / `reject` / `accept-all` / `reject-all` / `undo` — same `changeSets.*` as desktop / Chrome), **account** (`list` / `draft` / `add` / `remove` / `update` / `current` / `activate` / `verify` / `reveal` / `oauth` / `cancel` / `signout` — same `accounts.*` as desktop / Chrome Settings), **connectors** (`auth` / `probe` / `status` / `act` — same `connectors.authStatus` / `probe` / `cloudflare.status` / `connectors.act` as Chrome Settings), **github** (`pulls` / `pull` / `actions` / `run` / `releases` / `pages` — same tray as desktop / Chrome), **timers** (`list` / `create` / `add` / `get` / `update` / `run` / `remove` / `runs` / `sessions` — same tray / Schedule editor as desktop / Chrome), **logs** (`query` / `stats` / `clear` / `export` / `record` / `tail` — same Settings → Logs / `logs.subscribe` as Chrome), **settings** (`secret` / `hint` / `reveal-secret` — same `settings.setSecret` as Chrome), `host`, and **git** (`status` / `diff` / `init` / `branch` / `checkout` / `worktree` / `show` — same Git tab as desktop / Chrome). Live e2e (`product-matrix.spec.ts` / `vav-board-cli.spec.ts`) covers list, send, workspace, files (including `file stat` / `write` / `reveal` / `open` / `info`), remote, terminal (`pane run` plus `pane spawn` / `write` / `kill`), configure, accounts (including `account cancel` / rejected `account oauth`), regenerate, `git init`, logs, session star, and review seed / accept-all against one vav-server.
- `vav-tui` / `vav-tui` is the Claude Code-style agent CLI: interactive REPL with slash commands (`/help` `/model` `/cwd` `/files` `/permissions` `/cost` `/init` `/compact` `/duplicate` `/pin` `/star` `/archive` `/stop` `/rename` `/regenerate` `/fork` `/reply` `/edit` `/continue` `/review` `/account` `/settings` `/plugins` `/connectors` `/logs` `/file-session` `/export` `/git` `/timers` (`create` / `update` / `run` / `remove`) …), streaming `-p` print, `--mode json`, `--mode rpc`. Bare argv slashes (`vav-tui /files`) run those same commands without a TTY. The TTY prompt now prints the host reply after each line (same `writeTurn` as `--mode rpc`). Live e2e (`vav-board-cli.spec.ts`) runs `/files` `/settings` `/export` `/cost` `/git` `/git init` `/timers` `/init` `/edit` `/continue` `/review` `/pin` `/star` `/plugins` `/connectors` `/logs`, in-process `runVavTuiRpc` (`prompt` / `reply` / `quit`), the scripted REPL (`runVavTuiLines`), and a real PTY `vav-tui>` session (`hello from tty`) against one vav-server — including a parked Approve (`stubApprove`) completed via RPC `reply`. `/compact` is the host Compact verb, not a local transcript digest. `/account` and `/settings` read the same vav-server catalog as Settings. `/review` talks to the same `changeSets.*` catalog as `vav-board review` and the desktop / Chrome Accept card.
- Both discover vav-server via `--uri` / `VAV_SERVER_URI`, `~/.vav-server` + `listen.json`, the app's spawned state dir, or loopback `/discover`.
- A second `vav-server` on the same `--state` prints the live pairing instead of binding twice.
- Published as `@21stware/vav-board` and `@21stware/vav-tui` beside `@21stware/vav-server`.

### Products

- Seven-product workspace now owns source entries: Electron lives in `packages/vav-desktop/src`, vav-server / vav-board / vav-tui entries in their packages, Chrome in `packages/vav-chrome-extension/{extension,phone-ui}`, iOS / Android under `packages/vav-ios` / `packages/vav-android`. Shared kernel stays `src/main` + `src/shared`. See `docs/PRODUCT_MATRIX.md`.
- Android VAV Remote speaks the same phone protocol as iOS (hello omits `role`) and now mirrors the iOS surfaces: Sessions / Notifications / Settings tabs, pin / favorite / archive, thread + run bar (You / Agent, Thinking, tool rows, awaiting confirm), workspace picker, a persisted pairing book, Settings QR (`vav-remote:` / camera scan) plus paste, photo attachments on send, lock-screen banners that open the session, and Settings 诊断日志 (export / copy / clear, pairing secrets redacted) plus the same 电脑 / 默认配置 / Host 沙盒 / 诊断 build 4 copy as iOS.

### Reliability

- Headless vav-server keeps `pty.spawn` and `process.spawn` on the daemon after the client socket closes, so `vav-board pane spawn` / `write` / `kill` and a later `process.write` / `kill` work as separate commands (the same lifetime as a desktop New bash tab or Git spawn).
- Spawned-vav-server ACP now matches in-process for Thinking/Fast chips (advertised row, not a leftover “Grok 4.6 Fast” label), plan-doc Accept (no doubled card), follow-up user turns, and same-turn Recovering after a leaked transport error. Chrome / web apply that `turn.recovery` onto the same StreamStatus as desktop; iOS and Android show 恢复中 / 重试中 / 重连中 on the live turn and session subtitle.
- Android remote now matches the iOS client lifecycle: background `suspend()`, 4s foreground reconnect, optimistic send, thread timeout → `对话同步超时。下拉返回再进，或到设置里点立即重连。`, create-session notice, capability-gated 收藏 / 置顶, and send disabled while disconnected. Empty threads show the same `Harnessed by VAV` / `工作区是 …。` chrome as iOS. Agent transcripts render GFM (tables / task lists / fenced code) with the same `withAgentLineBreaks` rules as iOS MarkdownUI, and the run bar lives in the composer next to 添加照片 / Send.
- `vav-tui --mode rpc` returns on `quit` / `exit` instead of calling `process.exit` / closing the socket mid-loop, so the CLI entry (and in-process e2e) can shut down cleanly. The TTY REPL now `await`s the prompt loop before `phone.close()` (it used to drop the socket as soon as `vav-tui>` appeared) and prints the host reply after each line. Live e2e drives `runVavTuiRpc`, `runVavTuiLines`, and a real PTY `vav-tui>` session against a real vav-server.
- Required Chrome / web e2e (`e2e/specs/phone-ui.spec.ts`, in `test:e2e:vav-server`) builds the phone-ui bundle if needed (now with a live `@xterm/xterm`, not a stub class), opens the loopback shell, paints the desktop Settings overlay (same `settings-nav-*` categories, Logs retention writes the host catalog, Providers `accounts.createDraft`, Connect rotate offer, Appearance code fonts), sends a stub turn, creates a file, opens it in the desktop file-preview drawer (body `vav-phone-preview-body`, not only the filename — Chrome now implements `setPreviewCloseGuard` / `forcePreviewClose` so FileViewer does not crash), renames and trashes a Files tray row, Pins / Renames a session from the same DOM context menu as desktop, opens Git / Plugins after `git.init`, opens New bash, asserts the PTY echoes `vav-phone-term`, and mints another session with New Session — the same desktop session chrome, not a skippable node:test. Required Chrome MV3 e2e (`e2e/specs/chrome-extension.spec.ts`) loads the unpacked `extension/` as `chrome-extension://…/sidepanel.html` and runs that same Settings / composer / Files / preview / list Pin-Rename / Git / New bash / live xterm / New Session path. New bash on Chrome / web now mint a workspace slice when the session was never bound, so the tools tray actually gets a tab instead of spawning a hidden PTY.
- vav-server and the Chrome / web picker list the same CLI agents as desktop (Claude, Cursor, Codex, …). An empty session can switch host; a thread with messages stays locked. The side panel had been hiding every agent and the daemon had been rejecting anything but VAV.
- Swarm split on a spawned-vav-server workbench now keeps `swarmParentId` and the parent model on the child session, so ⌘D / toolbar / ⌘⇧D mount two panes instead of a second standalone chat. A visible selected transcript counts as foreground for unseen Done even when Playwright (or another app) stole OS focus.
- Android session turns now match iOS: 拷贝 a message, and 展开 / 收起 a long user turn. The session list shows 正在连接电脑… / 正在同步会话… and the same `刚刚 · 目录` / `流式中` subtitle as iOS. An offline thread shows 还没连上电脑 + 重试连接. Opening a thread records the viewing conversation (reconnect re-pulls it) and send / turn errors show 发送失败 instead of a generic link error. Live e2e (`phone-remote.spec.ts`) connects as those remotes do (`hello` omits `role`) and runs every shared phone-plane verb against one vav-server, including parked Approve reply / cancel.
- Chrome / web Connect paste (`hosts.pair`) now pairs a loopback or RFC1918 LAN `vavrtp://` the same way desktop Connect does (the side panel requests optional host permission for that LAN origin). WAN / Tailcat still stay on the desktop. Settings → Appearance lists the same code-font candidates as the workbench, and the custom accent / surface-pattern pickers use the browser color and PNG file inputs instead of no-ops. The side panel reports the host OS instead of a hardcoded Linux, so Finder labels match. Reveal in Finder, Open with default app, Quick Look, Get Info, and Copy as file now run on vav-server (`fs.reveal` / `openPath` / `preview` / `getInfo` / `copyAsFile`) — the same host file-manager actions a paired desktop window and `vav-board file reveal|open|info` use. Desktop Get Info / Copy as file on a remote machine spawn those same host commands instead of returning “not local”. The Chrome / web Files tray watches the workdir over `fs.watch` and refreshes dirty parent dirs on the same 300 ms cadence as desktop.
- Chrome side panel now replays the already-paired host / sessions / model catalog when it opens, so the picker can select a model and `hasKey` reaches settings. Opening the panel after the service worker connected used to boot with an empty catalog and “No API key”.
- Chrome extension pairing keeps a RFC1918 `ws://192.168.x.x:4752/vav` (or `10.` / `172.16–31.`) after the side panel grants optional host permission. WAN / unknown hosts still rewrite onto `127.0.0.1`.
- Chrome side panel / phone UI no longer white-screens on Files → Plugins: the phone `plugins` stub returns an empty snapshot, and the panel ignores incomplete `list` replies (`Cannot read properties of undefined (reading 'plugins')`).
- Chrome side panel / web Files tray lists and reads the session workdir over a second `/vav` hello (`role: 'daemon'`), same fs / pty plane as desktop remote. Phone `browse` (`files: true`) stays the fallback list. iOS / Android pickers stay directories-only.
- Chrome / web Settings → Accounts calls `accounts.getPage` / create / update / remove / verify / reveal / `beginOAuth` / `cancelOAuth` / `signOut` on the daemon plane (same AccountStore as vav-server). Desktop Settings IPC proxies those calls — including CLI browser login — to the spawned local vav-server so the workbench and Chrome share one key book. `vav-board account list|draft|add|remove|oauth|cancel|signout` and `vav-tui /account` (including `/account oauth` / `cancel` / `signout`) talk to that catalog. Named-branch desktop e2e (`launchWorkbench`) now boots that same spawned vav-server path for list, send, workspace, files, terminal, stream, transcript, workdir, change-review, session sidebar, Connect tunnel, pin/archive/rename/delete, shortcuts, Settings chrome, appearance, keybindings, About, log retention, unseen Done, quote/regenerate, rich seed, swarm, boot, ACP chrome, live ACP, and screenshot crop. Live ACP stdio (Cursor and Grok), `configure.mode`, usage / context ring, plan-accept, model pin, and network retry run on that vav-server — the same plane iOS / Android / Chrome / `vav-board configure --mode` / `vav-tui /run-mode` use. After a host turn the workbench pulls `sessions.get` so usage and resume cursors match the daemon store. A background stub turn on that vav-server sets `resultUnseen` on the workbench row. Ask / Approve / Cancel on a local chat reply through that vav-server instead of requiring a duplicate-source mapping. Change-review seeds with `changeSets.seedReview` after the local shell pairs, so Accept hits the same vav-server store Chrome / web already use. Legacy `settings.setApiKey` / connector token slots write `userData/vav-server/apikey` (and the other secret files) so Chrome Settings and the workbench share one key book.
- Desktop sidebar timers proxy `timers.*` to the spawned local vav-server, so scheduled jobs live in the same store Chrome / `vav-board timers` read (`userData/vav-server`) instead of a second `~/.vav-server` copy.
- Desktop Plugins / Git / GitHub / Connectors IPC proxy to that same vav-server. Chrome plugin create / enable unwraps `{ ok, snapshot }` to the snapshot desktop already returns, so the tray can toggle skills.
- Host settings (default model, approval, agents, trays, workdirs) live on vav-server (`settings.get` / update). Chrome Settings and desktop IPC merge those onto local appearance. `vav-board settings get|set` and `vav-tui /settings` read the same snapshot. Desktop e2e with spawned vav-server toggles a tray in Settings and reads the same row from `userData/vav-server/settings.json` and `vav-board settings set --approval`. A spawned-vav-server workbench matrix (`desktop-vav-server-matrix.spec.ts`) also covers list, send, Files preview, new file, Git / Plugins, and New bash through that same child host, and checks the stub turn is persisted only under `userData/vav-server/conversations`. Headless vav-server `git.status` no longer dies on ESM `__dirname` in `bundledBin` (Git tab showed “temp dir without version control” for a real repo).
- When the spawned loopback vav-server is up, desktop Files / git / New bash resolve through that host (`workspaceHostForConversation`) instead of in-process Node fs / node-pty, so Chrome and the workbench share one grant plane. Chrome Files Save / rename / trash / clip call `fs.writeFile` / `rename` / `unlink`. Local conversation JSON then lives only on that vav-server (`userData/vav-server/conversations`); the workbench sidebar is a memory cache and drops the Electron shard copy.
- Chrome-created vav-server sessions adopt into the desktop sidebar as local rows (`machineId: local`), and desktop New Session waits for the spawned vav-server pair (`waitForMountedLocalShell`) then creates on that host — it no longer falls through to an in-process `store.create` while auto-pair is still in flight. Settings → Agents binary probes for This Mac use that same vav-server `probeProviders` catalog. First-run empty (no API key) is that same spawned path: the no-key hero reads `settings.apiKeyPresent` from the vav-server catalog (`hostHoldsRemoteKeys` only hides it on a paired remote), so Configure an API Key still shows until a VAV account key or legacy `api` secret exists on that host (desktop `currentSettings` already counted account keys; vav-server now does too, and a workbench account write republishes the merged snapshot). Live e2e (`empty.spec.ts`) uses `launchWorkbench`. Screenshot crop e2e (`screenshot.spec.ts`) is that same spawned path after `seedVavKeyAccount`. Paste clips use the same `tmp/vav-tuips/<sha16>/name` layout on Chrome and desktop.
- Desktop rename / archive / configure / workdir / pin / delete for local chats dial the spawned vav-server (`dialControl`) so Chrome’s list drops the same session. Chrome Files / sidebar delete sends the phone-plane `archive` verb (`vav-board session delete` is that same verb).
- Chrome / web New bash opens a `pty.spawn` tab on the same daemon plane as desktop; web UI e2e asserts `terminal-panel` after `new-bash`. Chrome / web Settings → Connect treats the host as already listening (`remoteControlEnabled: true`) so the QR, rotate button, and pairing line match desktop Incoming. It reads the host `vavrtp://` offer (`host.pairing`) so the incoming pairing line and QR match desktop. `vav-board host pairing` prints the same URI. Rotate (`hosts.rotateOffer` / `vav-board host rotate` / `host.rotateOffer`) mints that same vav-server offer — desktop Connect proxies to the spawned daemon so the QR and copy line stay one secret. Authorized computers (`host.incoming` / disconnect / unpair) are that same grant list; Chrome and desktop Connect no longer keep a second empty book.
- Chrome / web File Preview sessions call `fileSessions.open` / create / list on the daemon plane (same FileSessionStore as vav-server), instead of a null stub. Desktop File Preview and change-review IPC proxy those calls to the spawned vav-server so local and Chrome share one index. Compact / regenerate / edit / fork / delete-message / leaf / duplicate / continue / goal / locate call the same phone-plane verbs as desktop. Folder pick and Locate use `hosts.listDir` over `fs.readdir`. Settings opens the same Settings window as an overlay and reads Settings → Logs from `logs.query` on that daemon. Binary preview uses `fs.readFile`. Change review Accept / Reject uses `changeSets.*` on the daemon plane. Clipboard image paste writes a host clip over `fs.writeFile`. Session export downloads the visible threads as JSON.
- iOS and Android session menus now send compact / duplicate / continue / regenerate / edit / fork / goal / locate / delete-message / leaf / review, matching the desktop and Chrome phone-plane verbs. Both remotes paint the host `goal` snapshot as a 目标 banner (暂停 / 继续 / 清除) and a 改动审查 card that lists file names then 全部接受 / 全部拒绝 when the thread carries `changeSetId` — names + status only, never file bytes. Required Chrome / web e2e seeds that same review and clicks Accept all on the desktop `inline-review` card. Temporary workspaces open the same folder picker for Locate.
- `vav-board session locate|delete-message|leaf` and `vav-tui` `/goal` `/locate` `/leaf` `/delete` use those same phone-plane verbs.
- Chrome / web Git tab calls `git.status` / `diff` / `init` on that daemon plane, so the Git panel matches the desktop workbench instead of an empty stub. File Preview inspects the same path over `fs.stat` + `fs.readFile` (`files.inspect`) so the desktop drawer can paint a markdown file instead of crashing on a missing inspect. Chrome `window.setPreviewCloseGuard` / `forcePreviewClose` / `onPreviewCloseAttempt` are no-ops (desktop uses them for unsaved close); without them FileViewer threw and the error boundary hid the body. The Settings overlay no longer light-bootstraps the shared session store (that cleared `activeId` and broke the live chat). Chrome `window.openFilePreview` opens that same session drawer (`vav:phone-open-file-preview`) instead of a no-op.
- Chrome / web Plugins tab calls `plugins.list` / `setEnabled` / `create` / `write` on the same daemon plane.
- Android Remote dials tailcat QR tokens (`tc…`) the same way iOS does (`Tcmobile.dial`). Build `tcmobile.aar` with `node scripts/build-tailcat-android.mjs`; LAN `vavrtp://` still works without it.
- `vav-board git status|diff|init|branch|checkout|worktree|show` and `vav-board plugins list|create|enable|disable|write` talk to that host catalog — the same `plugins.*` / `git.*` verbs as the desktop / Chrome Git and Plugins tabs. `vav-tui /git` prints the session workdir snapshot; `/git init` / `/git branch` / `/git checkout` / `/git worktree` are the same host verbs as the desktop / Chrome Git tab. `/plugins create skill <name>` writes that same vav-server skill tree.
- Desktop bash restore (`pty-sessions.json`) stays off when the window is a shell over spawned or paired vav-server (`shouldRestoreInProcessPty`), so Chrome and a remote workbench do not see a second in-process pane book. `npm run pack:desktop` syncs `@21stware/vav-desktop` with the repo Electron entry.
- Desktop local chats send through the spawned vav-server under the same session id (no catalog-adopted duplicate, no in-process DeepSeek fallback), so local and paired-remote turns stay on one plane. File Preview, compact / regenerate / edit / fork / delete / leaf now forward to that same vav-server instead of a second in-process store.
- Chrome / web `hosts.list` returns the paired host instead of `[]`, so the sidebar service chip matches bootstrap after a reconnect.
- `cursor-agent acp` is launched with a hyphen `--model` id (`cursor-grok-4.6-medium`), never an ACP bracket overlay. Bracket / family ids on that flag exited the child with "Cannot use this model". `session/set_model` uses the advertised family row only; invented `[effort=…]` overlays are rejected by Cursor.
- `vav-server` and ESM tests no longer crash on boot with `__dirname is not defined` when loading bundled skills (Plugins wiring constructed `SkillService` at control-plane start).
- Electron e2e strips inherited `ELECTRON_RUN_AS_NODE` so Playwright can launch the workbench (`--remote-debugging-port`) in agent / CI shells that run Electron-as-Node.

### Plugins

- Files tray adds a Plugins tab (after Artifacts) for global agent capabilities: skills, MCP servers, and hooks.
- VAV sessions read and write `~/.vav` (`VAV_HOME` override): `skills/`, `mcp.json`, `hooks.json`, and `plugins/<name>/` packages. Enable flags live in `plugins.json`. The next VAV turn loads those same files (`load_skill`, hook stdout, MCP tools named `mcp_<server>_<tool>`).
- ACP / other CLI hosts show that product’s on-disk plugins (Cursor, Claude, Grok, Codex, …) and open the files the host itself consumes. Create / enable stays VAV-only.
- The tab is available without a workspace. Opening a skill or config uses the real path, so preview edits change what the agent (or ACP host) reads.

### Connectors

- Settings → Connectors holds GitHub / Cloudflare / Supabase / Vercel trays and tokens (moved off Workspace).
- Sign in opens the official CLI browser login (`gh auth login`, `wrangler login`, `supabase login`, `vercel login`). Pasted tokens stay optional overrides.
- Vercel reuses a local `vercel login` the same way Cloudflare uses Wrangler and GitHub uses `gh`.
- Vercel is a first-class connector: Files tray, API token, and `connector` tool `deploy`.
- GitHub stays read-only. Cloudflare, Supabase, and Vercel deploy through the connector tool (approval required; timer runs use Bypass).

### Scheduled tasks

- Sidebar → More → Scheduled tasks. The editor is a schedule page (name, enable, run, visual once/daily/weekly/monthly), not a chat with a send button or terminal.
- Each fire adds a session under that schedule (pin, star, delete, archive). These stay out of the main project list.
- Jobs persist in `~/.vav-server` so a running vav-server system service fires them on time (desktop yields while vav-server is listening).
- Each fire still mints a timestamped workspace and writes `output.md`.

### Artifacts

- After the last message, the transcript lists unique files written on the visible branch (HTML, Office, media, notes, and other writes).
- Workbench Files tray has an Artifacts tab immediately after Files (before Git) with the same catalog and an empty state when nothing has been written.
- Click a row to open preview; right-click to reveal or copy the path. Source-only edits collapse behind “more files” when a deliverable is also present.
- The list updates while a turn is still writing.

### Files

- Drag a Files row or the preview title out of VAV and other apps receive the real file (Electron `startDrag`), not an HTML ghost.
- Right-click Copy puts the file on the clipboard the way Finder / Explorer do. Get Info (macOS) and Properties (Windows) open the system inspector. Open with default app is on the same menu.

### Logs

- User send/stop/answer and agent turn/tool/error lines land in a diagnostic log (no message bodies, no secrets).
- Temporary records stay in memory 15 minutes; session records last 24 hours or until the chat is deleted; durable records default to 7 days (1–30).
- Settings → Logs to filter, search, export, clear temporary records, or clear everything.

## 1.19.1

CLI ACP turns no longer stay on Streaming after the child dies or the handshake hangs. The Chrome extension can find a local `vav-server` and run a full chat from the side panel.

### Reliability

- Stop aborts an in-flight spawn; missing TEMP DIR folders are recreated.
- Cursor TUI flags (`--force --trust`) are not passed to `cursor-agent acp`.

### Chrome extension

- Side panel finds a local `vav-server` on loopback (`/discover` on :4752–4762) and pairs without pasting a URL or secret.
- Conversation UI matches the phone client: sessions, agent-log blocks, model/approval, ask cards, and streaming.
- Page context, selection, screenshot, context menus, and an in-page “Ask VAV” chip ride along with a turn.
- Toolbar icons are the VAV mark at 16/32/48/128.

## 1.19.0

Headless `vav-server` is the host. Desktop, Connect, the Chrome extension, the web page, the `vav` CLI, and VAV Remote are shells over that daemon.

### Headless vav-server

- `npx @21stware/vav-server` / `vav-server` hosts sessions, keys, files, PTY, and agent turns. Pair from VAV → Connect, VAV Remote, the web UI (`http://127.0.0.1:4752`), or the Chrome extension.
- Desktop can launch as a vav-server UI with `VAV_SERVER_URI` / `--vav-server-uri`, or spawn the daemon with `VAV_SERVER_SPAWN=1` / `--with-vav-server`. Packaged apps spawn the bundled daemon by default (`--no-vav-server` / `VAV_SERVER_SPAWN=0` keeps the in-process host).
- Packaged apps ship `vav-server.js` so `--with-vav-server` works without the git checkout.
- GitHub Releases attach the `@21stware/vav-server` tarball and the Chrome extension zip, and fail if any required asset is missing.

### Clients

- Chrome extension (MV3 side panel) speaks the same phone protocol as the web page over `ws://127.0.0.1:4752/vav`.
- VAV Remote 1.0.4 accepts a pasted `vav-daemon://` URI and dials LAN TCP (still pairs via tailcat QR as before).
- `vav send` drives a turn on the daemon over the phone protocol.

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
