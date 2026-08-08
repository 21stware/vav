# Install notes

## macOS

Download the arm64 DMG. Open it, drag **VAV** to Applications.

Releases ship a Developer ID–signed and notarized DMG (ticket stapled). Prefer dragging to Applications rather than launching from the disk image.

If Gatekeeper still blocks open (rare; dialog may say the app is “damaged”):

1. System Settings → Privacy & Security → Open Anyway, or
2. Terminal: `sudo xattr -cr /Applications/VAV.app`

## Windows

Run the x64 setup. SmartScreen may warn on first launch — choose More info → Run anyway.

## CLI

After install, enable the `vav` command in Settings. Then:

```bash
vav .
```

opens a session in the current directory.

## Next

- Bind a file session from Finder (Open With → vav)
- Press ⌘⇧↵ for a floating quick ask
