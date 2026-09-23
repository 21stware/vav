# Brand packs

Build-time product skin. Swap the folder (or set `BRAND=<slug>`) and run
`npm run brand:apply`.

```text
brand/<slug>/
  identity.json
  prompts/system-identity.txt
  i18n/en.json
  i18n/zh-CN.json
  icon.png            # optional — copied to build/
  icon-dark.png
  icon-mark.png
  wordmark.png        # optional — copied over renderer wordmark
  wordmark-dark.png
  icon-composer/      # optional Icon Composer plates
```

`identity.json` is the display name, bundle id, About copyright, and the
system-prompt first line (`{product}` / `{os}`).

Do not rename wire slugs here: `vav://`, `vavrtp://`, `window.vav`, the
agent id `vav`, or CLI binaries. Those stay in the kernel.

Icons that are omitted keep the current `build/icon.png` set.
