#!/usr/bin/env node
/**
 * Compatibility entry for the `vav` npm bin.
 * Control-plane commands now live on `vav-board` (herdr-style). This file stays so
 * `vav send` / `npm run vav` keep working against the same vav-server.
 */
import { runVavBoard } from '../../../packages/vav-board/src/vav-board.ts'

void runVavBoard().then(
  (code) => {
    if (code) process.exit(code)
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
    process.exit(1)
  }
)
