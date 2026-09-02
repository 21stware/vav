# Contributing

Requires **Node 22+** (CI and `@21stware/vavd` use 22). macOS or Windows for a full desktop build; unit tests run on Linux too.

```bash
npm ci
npm test              # globbed unit tests (skips *.live.test.ts)
npm run typecheck
npm run build         # typecheck + electron-vite
```

`npm test` discovers `src/**/*.test.ts` and `scripts/**/*.test.mjs`. Network-backed files (`*.live.test.ts`) are opt-in: `npm run test:live`. Playwright Electron e2e is local-only (`npm run test:e2e`).

Do not add new tests only to a hardcoded list — the runner globs.

## Pull requests

- Keep changes reviewable. The main process (`src/main/index.ts`) and renderer stores are large; prefer extracting a helper + test over growing them.
- Pair a behavior change with a unit test when the logic is pure (protocol, i18n matching, hydration, buffers).
- `npm test` and `npm run typecheck` must stay green.

## Release

Tags `v*` drive `.github/workflows/release.yml` (signed macOS, unsigned Windows, optional npm publish of `vavd`). Bump `package.json` and `packages/vavd` together. There is no automated changelog yet — summarize user-facing changes in the GitHub Release notes.
