/**
 * Skip published trampolines and exec the real agent binary.
 *
 * - Grok on PATH is a Node script that then spawn()s ~/.grok/bin/grok
 * - cursor-agent is a bash wrapper that probes node, then execs index.js
 *
 * Both are correct, and both add a process hop the user waits on. Once the
 * inner file already exists we launch it with the same argv / env the wrapper
 * would have used.
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export type UnwrappedLaunch = {
  file: string
  args: string[]
  env: Record<string, string>
  argv0?: string
}

const CURSOR_WRAPPERS = new Set(['cursor-agent', 'cursor-agent.cmd', 'agent', 'agent.cmd'])
const systemCaByNode = new Map<string, boolean>()

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return existsSync(file)
  }
}

function leafName(file: string): string {
  return basename(file.trim()).toLowerCase()
}

function grokHome(): string {
  return process.env.GROK_HOME?.trim() || join(homedir(), '.grok')
}

function nativeGrokPath(): string {
  const name = process.platform === 'win32' ? 'grok.exe' : 'grok'
  return join(grokHome(), 'bin', name)
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return a === b
  }
}

function unwrapGrok(resolved: string, args: string[]): UnwrappedLaunch | null {
  const leaf = leafName(resolved)
  if (leaf !== 'grok' && leaf !== 'grok.exe') return null
  const native = nativeGrokPath()
  if (!isExecutable(native)) return null
  if (samePath(resolved, native)) return null
  return {
    file: native,
    args,
    env: { GROK_MANAGED_BY_NPM: '1' }
  }
}

function cursorCompileCache(): string {
  if (process.env.NODE_COMPILE_CACHE?.trim()) return process.env.NODE_COMPILE_CACHE
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'cursor-compile-cache')
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim()
  return join(xdg || join(homedir(), '.cache'), 'cursor-compile-cache')
}

function cursorUsesSystemCa(node: string): boolean {
  const hit = systemCaByNode.get(node)
  if (hit !== undefined) return hit
  try {
    execFileSync(node, ['--use-system-ca', '--version'], {
      timeout: 1500,
      stdio: 'ignore'
    })
    systemCaByNode.set(node, true)
    return true
  } catch {
    systemCaByNode.set(node, false)
    return false
  }
}

function unwrapCursor(resolved: string, args: string[]): UnwrappedLaunch | null {
  if (!CURSOR_WRAPPERS.has(leafName(resolved))) return null
  let dir: string
  try {
    dir = dirname(realpathSync(resolved))
  } catch {
    dir = dirname(resolved)
  }
  const node = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
  const index = join(dir, 'index.js')
  if (!isExecutable(node) || !existsSync(index)) return null
  const invokedAs = basename(resolved)
  const nodeArgs = cursorUsesSystemCa(node)
    ? ['--use-system-ca', index, ...args]
    : [index, ...args]
  return {
    file: node,
    args: nodeArgs,
    argv0: invokedAs,
    env: {
      CURSOR_INVOKED_AS: invokedAs,
      NODE_COMPILE_CACHE: cursorCompileCache()
    }
  }
}

export function unwrapAgentLaunch(resolved: string, args: string[]): UnwrappedLaunch {
  const file = resolved.trim()
  if (!file) return { file, args, env: {} }
  return unwrapGrok(file, args) ?? unwrapCursor(file, args) ?? { file, args, env: {} }
}

export function clearUnwrapCaches(): void {
  systemCaByNode.clear()
}
