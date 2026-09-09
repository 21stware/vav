# vav-chrome-extension

Chrome side panel for [VAV](https://github.com/21stware/vav). Same session shell as
desktop / the local web UI. Source is `extension/` (MV3) and `phone-ui/` (React shell).

Talks to **vav-server** as `phone` (sessions) plus a second `/vav` hello as `daemon`
(fs / pty). Load the unpacked `extension/` folder in `chrome://extensions`.

```bash
# from the repo root
npm run build:phone-ui
```
