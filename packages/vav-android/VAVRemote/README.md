# VAV Remote (Android)

Android counterpart of `ios/VAVRemote`. Same phone-protocol client: scan the
Settings QR (`vav-remote:{…}`) or paste a `vavrtp://` line (hello omits `role`),
then use the same three tabs as iOS —

- **会话** — pinned / favorite filter, pin / star / archive / rename, thread,
  run bar (`mode · permission`, agent/model, `thinking · Fast`), send queue,
  live tool blocks, workspace picker, photo attachments
- **通知** — turn-complete / ask / approval
- **设置** — pairing book, host defaults, capability split (phone vs computer)

Settings QR tokens that start with `tc` dial the same tailcat bridge iOS uses
(`Tcmobile.dial`). Build the optional AAR first:

```
node scripts/build-tailcat-android.mjs
```

Without the AAR the app still pairs over LAN (`vavrtp://`). Open
`android/VAVRemote` in Android Studio (SDK 35, min 26) and run the `app`
configuration.
