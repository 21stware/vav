/**
 * Start a local `vavd` process and read the printed pairing URI.
 * Desktop `--with-vavd` and the e2e harness share this so the app is a shell.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

export type SpawnedVavd = {
  pairing: string
  machineId: string
  name: string
  stateDir: string
  stop: () => void
}

export type SpawnLocalVavdOptions = {
  name?: string
  stateDir?: string
  listen?: string
  port?: number
  noWeb?: boolean
  noAnnounce?: boolean
  stubTurn?: boolean
  stubStream?: boolean
  stubApprove?: boolean
  cwd?: string
  extraEnv?: NodeJS.ProcessEnv
}

export function findVavdScript(from = process.cwd()): string | null {
  const candidates = [
    join(from, 'src/main/daemon/vavd.ts'),
    join(from, '..', 'src/main/daemon/vavd.ts'),
    join(from, '../..', 'src/main/daemon/vavd.ts')
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

export type VavdEntry = {
  kind: 'source' | 'bundle'
  path: string
  root: string
}

/**
 * Dev uses `vavd.ts`. Packaged apps use `Resources/vavd/vavd.js` from the
 * GitHub / electron-builder extraResources copy of the npm bundle.
 */
export function findVavdEntry(
  from = process.cwd(),
  resourcesPath?: string
): VavdEntry | null {
  const source = findVavdScript(from)
  if (source) {
    return {
      kind: 'source',
      path: source,
      root: dirname(dirname(dirname(dirname(source))))
    }
  }
  const res =
    resourcesPath ||
    (typeof process.resourcesPath === 'string' ? process.resourcesPath : '')
  const bundled = res ? join(res, 'vavd', 'vavd.js') : ''
  if (bundled && existsSync(bundled)) {
    return { kind: 'bundle', path: bundled, root: dirname(bundled) }
  }
  const packed = join(from, 'packages', 'vavd', 'vavd.js')
  if (existsSync(packed)) {
    return { kind: 'bundle', path: packed, root: from }
  }
  return null
}

export function vavdNodeArgs(entry: VavdEntry, flags: string[]): string[] {
  if (entry.kind === 'bundle') return [entry.path, ...flags]
  return [
    '--import',
    registerHook(entry.root),
    '--experimental-strip-types',
    entry.path,
    ...flags
  ]
}

/**
 * `process.execPath` inside Electron is the app binary, not Node.
 * Prefer a real Node so `--import` / strip-types run vavd, not another window.
 */
export function resolveNodeForVavd(
  env: NodeJS.ProcessEnv = process.env,
  versions: { electron?: string } = process.versions
): { cmd: string; asNode: boolean } {
  if (!versions.electron) return { cmd: process.execPath, asNode: false }
  for (const candidate of [env.npm_node_execpath, env.NODE_BINARY]) {
    if (candidate && existsSync(candidate)) return { cmd: candidate, asNode: false }
  }
  return { cmd: 'node', asNode: false }
}

function registerHook(root: string): string {
  return pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href
}

export async function spawnLocalVavd(
  options: SpawnLocalVavdOptions = {}
): Promise<SpawnedVavd> {
  const cwd = options.cwd ?? process.cwd()
  const entry = findVavdEntry(cwd)
  if (!entry) {
    throw new Error(`vavd not found from ${cwd} — run from the VAV repo, install the app bundle, or pass VAVD_URI`)
  }
  const root = entry.root
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), 'vavd-spawn-'))
  const name = options.name ?? 'VAV Daemon'
  const flags = [
    '--port',
    String(options.port ?? 0),
    '--listen',
    options.listen ?? '127.0.0.1',
    '--state',
    stateDir,
    '--name',
    name
  ]
  if (options.noAnnounce !== false) flags.push('--no-announce')
  if (options.noWeb !== false) flags.push('--no-web')
  const args = vavdNodeArgs(entry, flags)

  const node = resolveNodeForVavd()
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.extraEnv ?? {}),
    ...(options.stubTurn || options.stubStream || options.stubApprove
      ? { VAV_E2E: '1', VAV_E2E_STUB_TURN: '1' }
      : {}),
    ...(options.stubStream ? { VAV_E2E_STUB_STREAM: '1' } : {}),
    ...(options.stubApprove ? { VAV_E2E_STUB_APPROVE: '1' } : {}),
    ...(node.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  }
  const child: ChildProcess = spawn(node.cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: root,
    env: childEnv
  })

  const pairing = await waitForPairing(child)
  const payload = parseDaemonPairing(pairing)
  if (!payload) {
    child.kill('SIGTERM')
    throw new Error(`unrecognized vavd pairing: ${pairing}`)
  }

  let stopped = false
  return {
    pairing,
    machineId: payload.machineId,
    name: payload.name,
    stateDir,
    stop: () => {
      if (stopped) return
      stopped = true
      child.kill('SIGTERM')
      rmSync(stateDir, { recursive: true, force: true })
    }
  }
}

function waitForPairing(child: ChildProcess, timeoutMs = 12_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderrTail = ''
    const timer = setTimeout(() => {
      reject(new Error(`vavd did not print pairing.\n${stdout}\n${stderrTail}`))
    }, timeoutMs)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrTail += chunk
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      const line = stdout.split('\n').find((row) => row.startsWith('vav-daemon:'))
      if (line) {
        clearTimeout(timer)
        resolve(line.trim())
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`vavd exited ${code}: ${stderrTail || stdout}`))
    })
  })
}
