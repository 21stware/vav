# VAV product matrix

Two products, one control plane. Turns, keys, files, and PTYs live in **vav-server**.
The desktop app is a shell over that daemon. A loopback web UI is bundled with vav-server.

| Product | Role | Talks to vav-server as |
| --- | --- | --- |
| **vav-server** | Core service. Sessions, secrets, files, PTY, agent turns. Serves the loopback web UI. | — |
| **vav-desktop** | Local workbench (`packages/vav-desktop/src`). Same UI for a local vav-server and a paired remote. In-process PTY restore is off when this window is a shell over vav-server. | `phone` + `daemon` |

The loopback web UI (`src/web-ui`) mounts the same session shell as desktop (`App` + run bar) over WebSocket.

## Alignment

- Desktop local and desktop-paired-to-vav-server are the same sidebar: switch the service chip, do not mint a second chat. Sessions created on the spawned vav-server adopt as local workbench rows. New Session on desktop waits for the spawned vav-server pair (`waitForMountedLocalShell`) then creates on that vav-server first.
- Local conversation JSON lives only under the spawned vav-server state dir; Electron `userData/conversations` keeps paired-remote rows, not a second local transcript.
- File Preview, change-review, accounts, timers, plugins, Git / GitHub, connectors, host settings, Files tray I/O, git spawn, and PTY resolve through that vav-server host.
- Appearance / fonts stay on the client.

## Source

Root is an npm workspace (`packages/*`). Each product owns its entry tree.
The shared kernel (`src/main/` + `src/shared/`) stays outside the packages.
The loopback UI lives in `src/web-ui`.

| Product | Identity | Source |
| --- | --- | --- |
| vav-server | `packages/vav-server/` (`@21stware/vav-server`) | `packages/vav-server/src/vav-server.ts` (kernel: `src/main/daemon/`) |
| vav-desktop | `packages/vav-desktop/` (`@21stware/vav-desktop`) | `packages/vav-desktop/src/{main,preload,renderer}` |

Catalog: `src/shared/productCatalog.ts`. Shared contracts: `src/shared/remoteControl.ts` (session plane), `src/shared/daemonProtocol.ts` (fs / pty).
