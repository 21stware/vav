#!/usr/bin/env node
/**
 * Headless VAV daemon.
 *
 * Hosts the workspace plane (fs / spawn / pty) and the session plane
 * (send / thread / live turn). Pair from a desktop or phone with the
 * printed URI. The local web UI and Chrome extension discover a loopback
 * daemon automatically.
 *
 *   npm run vavd
 *   npx @21stware/vavd
 *   vavd --web-port 4752
 */

import { runVavdAdminCommand } from './vavdAdmin.ts'
import { formatVavdHelp, parseVavdArgs, resolveVavdVersion } from './vavdArgs.ts'

async function main(): Promise<void> {
  const parsed = parseVavdArgs(process.argv)
  if (parsed.kind === 'help') {
    process.stdout.write(formatVavdHelp())
    return
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`vavd ${resolveVavdVersion()}\n`)
    return
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`)
    process.stderr.write('Try vavd --help.\n')
    process.exitCode = 1
    return
  }
  if (parsed.kind === 'admin') {
    const text = await runVavdAdminCommand(parsed.stateDir, parsed.command, parsed.id)
    process.stdout.write(text)
    return
  }

  const { serveVavd } = await import('./vavdServe.ts')
  await serveVavd(parsed.options)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
