# Official macOS icon overlays

Copied from the local system for reproducible icon generation:

- `AppIconMask.png` ← `IconsetResources.bundle` / `AppIconMask_448@2x.png` (896×896)
- `AppIconShadow.png` ← `IconsetResources.bundle` / `AppIconShadow_512@2x.png` (1024×1024)

These are the same shape/shadow assets macOS uses for app tiles. Do not hand-paint
replacements — re-copy from CoreServices if they need updating:

```bash
ICONSET=/System/Library/CoreServices/IconsetResources.bundle/Contents/Resources
cp "$ICONSET/AppIconMask_448@2x.png" brand/icon-overlays/AppIconMask.png
cp "$ICONSET/AppIconShadow_512@2x.png" brand/icon-overlays/AppIconShadow.png
```
