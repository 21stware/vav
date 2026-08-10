# Bundled binaries

## officecli

[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0) — AI-oriented CLI for `.docx` / `.xlsx` / `.pptx`.

Binaries are **not** committed. Fetch the pinned release before `dev` / `dist`:

```bash
node scripts/fetch-officecli.mjs
# or: npm run fetch:officecli
```

Version pin: `scripts/fetch-officecli.mjs` (`OFFICECLI_VERSION` env overrides).

At runtime VAV prepends this directory to the agent shell `PATH` so `officecli` resolves without a system install.
