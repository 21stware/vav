/**
 * Shell shims Settings → Command Line writes next to `vav`.
 * `vav` opens the desktop app; `vav-server` is the daemon.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findVavServerEntry, resolveNodeForVavServer, type VavServerEntry } from '../daemon/vavServerSpawn.ts'

export const CLI_BIN_NAMES = ['vav', 'vav-server'] as const
export type CliBinName = (typeof CLI_BIN_NAMES)[number]
export const DAEMON_BIN_NAMES = ['vav-server'] as const
export const LEGACY_CLI_BIN_NAMES = ['vav-board', 'vav-tui', 'vavc', 'vavcli'] as const

export type NodeBinSpec = {
  name: 'vav-server'
  execPath: string
  asNode: boolean
  scriptPath: string
  extraNodeArgs: string[]
  stateDir: string
}

export function nodeBinLauncherScript(spec: NodeBinSpec): string {
  const lines = [
    '#!/bin/sh',
    'set -e',
    `BIN=${JSON.stringify(spec.execPath)}`,
    `SCRIPT=${JSON.stringify(spec.scriptPath)}`,
    `export VAV_SERVER_STATE=${JSON.stringify(spec.stateDir)}`
  ]
  if (spec.asNode) lines.push('export ELECTRON_RUN_AS_NODE=1')
  if (spec.extraNodeArgs.length) {
    const args = spec.extraNodeArgs.map((arg) => JSON.stringify(arg)).join(' ')
    lines.push(`exec "$BIN" ${args} "$SCRIPT" "$@"`)
  } else {
    lines.push('exec "$BIN" "$SCRIPT" "$@"')
  }
  lines.push('')
  return lines.join('\n')
}

export function findCliSource(name: 'vav-server', from = process.cwd()): string | null {
  if (name !== 'vav-server') return null
  const entry = findVavServerEntry(from)
  return entry?.kind === 'source' ? entry.path : null
}

export function findCliBundle(
  name: 'vav-server',
  from = process.cwd(),
  resourcesPath?: string
): string | null {
  const file = `${name}.js`
  const res = resourcesPath || (typeof process.resourcesPath === 'string' ? process.resourcesPath : '')
  const bundled = res ? join(res, 'vav-server', file) : ''
  if (bundled && existsSync(bundled)) return bundled
  const packed = join(from, 'packages', 'vav-server', file)
  if (existsSync(packed)) return packed
  return null
}

export function resolveNodeBinSpec(
  name: 'vav-server',
  opts: { cwd?: string; resourcesPath?: string; stateDir: string }
): NodeBinSpec | null {
  const cwd = opts.cwd ?? process.cwd()
  const node = resolveNodeForVavServer()
  const source = findCliSource(name, cwd)
  if (source) {
    const entry: VavServerEntry | null = findVavServerEntry(cwd)
    const root = entry?.root ?? cwd
    const hook = join(root, 'scripts', 'register-shared-alias.mjs')
    const extraNodeArgs = existsSync(hook)
      ? ['--import', `file://${hook}`, '--experimental-strip-types']
      : ['--experimental-strip-types']
    return {
      name,
      execPath: node.cmd,
      asNode: node.asNode,
      scriptPath: source,
      extraNodeArgs,
      stateDir: opts.stateDir
    }
  }
  const bundle = findCliBundle(name, cwd, opts.resourcesPath)
  if (!bundle) return null
  return {
    name,
    execPath: node.cmd,
    asNode: node.asNode,
    scriptPath: bundle,
    extraNodeArgs: [],
    stateDir: opts.stateDir
  }
}
