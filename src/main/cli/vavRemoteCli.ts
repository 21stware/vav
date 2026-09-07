#!/usr/bin/env node
/**
 * Compatibility entry for the `vav` npm bin.
 * Control-plane commands now live on `vavc` (herdr-style). This file stays so
 * `vav send` / `npm run vav` keep working against the same vavd.
 */
import { runVavc } from '../../../packages/vavc/src/vavc.ts'

void runVavc().then(
  (code) => {
    if (code) process.exit(code)
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  }
)
