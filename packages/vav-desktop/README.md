# vav-desktop

Local workbench for [VAV](https://github.com/21stware/vav). Same session shell for a
local vavd and a paired remote: switch the service chip, do not mint a second chat.

Turns, keys, files, and PTYs stay in **vavd**. Electron source lives here
(`src/main`, `src/preload`, `src/renderer`) plus `electron-builder.json`.

```bash
# from the repo root
npm run dev
# or from this package
npm start
# sync this package's version with the repo
npm run pack:desktop
```

Pair another machine from Settings → 连接 (`vavrtp://` or the phone QR
`vav-remote:{…}`). Desktop talks to vavd as both `phone` (sessions) and
`daemon` (fs / pty).
