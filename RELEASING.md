# Releasing

Tags `v*` drive `.github/workflows/release.yml`.

1. Land changes on `main`. Keep [CHANGELOG.md](CHANGELOG.md) updated under **Unreleased**.
2. Bump `version` together in `package.json`, `package-lock.json`, and `packages/vav-server/package.json`.
3. Move Unreleased notes into a new `## x.y.z` section in CHANGELOG.md.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The workflow builds signed macOS and unsigned Windows artifacts, packs `@21stware/vav-server`, **verifies every required asset is present**, then publishes the GitHub Release. Optional npm publish of `vav-server` follows.

Required GitHub Release assets (see `scripts/release-assets.mjs`):

- `VAV-x.y.z-macos-arm64.dmg` / `.zip` / `.zip.blockmap` + `latest-mac.yml`
- `VAV-x.y.z-windows-x64-setup.exe` / `.exe.blockmap` + `latest.yml`
- `21stware-vav-server-x.y.z.tgz`

Windows Authenticode signing is not configured; the Windows build ships unsigned until a cert is added to the workflow secrets.

Requires Node 22. macOS runners need `setuptools` for `electron-trackpad-utils` (the workflow installs it).

Root `package.json` `dependencies` are what electron-builder copies into the app. Renderer-only libraries stay in `devDependencies` — Vite already bundles them. Do not add Mermaid, Vega, React, or other UI packages back to `dependencies` or the asar balloons again.
