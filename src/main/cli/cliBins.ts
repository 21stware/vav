/**
 * Shell shims Settings → Command Line writes next to `vav`.
 * `vav` opens the desktop app; `vavd` / `vavc` / `vavcli` talk to the daemon.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findVavdEntry, resolveNodeForVavd, type VavdEntry } from '../daemon/vavdSpawn.ts'

export const CLI_BIN_NAMES = ['vav', 'vavd', 'vavc', 'vavcli'] as const
export type CliBinName = (typeof CLI_BIN_NAMES)[number]
export const DAEMON_BIN_NAMES = ['vavd', 'vavc', 'vavcli'] as const

export type NodeBinSpec = {
  name: 'vavd' | 'vavc' | 'vavcli'
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
    `export VAVD_STATE=${JSON.stringify(spec.stateDir)}`
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

export function findCliSource(name: 'vavd' | 'vavc' | 'vavcli', from = process.cwd()): string | null {
  if (name === 'vavd') {
    const entry = findVavdEntry(from)
    return entry?.kind === 'source' ? entry.path : null
  }
  const candidates = [
    join(from, 'src/main/cli', `${name}.ts`),
    join(from, '..', 'src/main/cli', `${name}.ts`),
    join(from, '../..', 'src/main/cli', `${name}.ts`)
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

export function findCliBundle(
  name: 'vavd' | 'vavc' | 'vavcli',
  from = process.cwd(),
  resourcesPath?: string
): string | null {
  const file = `${name}.js`
  const res = resourcesPath || (typeof process.resourcesPath === 'string' ? process.resourcesPath : '')
  const bundled = res ? join(res, 'vavd', file) : ''
  if (bundled && existsSync(bundled)) return bundled
  const packed = join(from, 'packages', 'vavd', file)
  if (existsSync(packed)) return packed
  return null
}

export function resolveNodeBinSpec(
  name: 'vavd' | 'vavc' | 'vavcli',
  opts: { cwd?: string; resourcesPath?: string; stateDir: string }
): NodeBinSpec | null {
  const cwd = opts.cwd ?? process.cwd()
  const node = resolveNodeForVavd()
  const source = findCliSource(name, cwd)
  if (source) {
    const entry: VavdEntry | null = findVavdEntry(cwd)
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
