/**
 * Start a local `vav-server` process and read the printed pairing URI.
 * Desktop `--with-vav-server` and the e2e harness share this so the app is a shell.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDaemonPairingLine, parseDaemonPairing } from '../../shared/daemonProtocol.ts'

export type SpawnedVavServer = {
  pairing: string
  machineId: string
  name: string
  stateDir: string
  webOrigin?: string
  stop: () => void
}

export type SpawnLocalVavServerOptions = {
  name?: string
  stateDir?: string
  listen?: string
  port?: number
  noWeb?: boolean
  webPort?: number
  webListen?: string
  noAnnounce?: boolean
  stubTurn?: boolean
  stubStream?: boolean
  stubApprove?: boolean
  cwd?: string
  extraEnv?: NodeJS.ProcessEnv
}

export function findVavServerScript(from = process.cwd()): string | null {
  const candidates = [
    join(from, 'packages/vav-server/src/vav-server.ts'),
    join(from, '..', 'packages/vav-server/src/vav-server.ts'),
    join(from, '../..', 'packages/vav-server/src/vav-server.ts'),
    join(from, 'packages/vav-server/src/vav-server.ts'),
    join(from, '..', 'packages/vav-server/src/vav-server.ts'),
    join(from, '../..', 'packages/vav-server/src/vav-server.ts')
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

export type VavServerEntry = {
  kind: 'source' | 'bundle'
  path: string
  root: string
}

/**
 * Dev uses `vav-server.ts`. Packaged apps use `Resources/vav-server/vav-server.js` from the
 * GitHub / electron-builder extraResources copy of the npm bundle.
 */
export function findVavServerEntry(
  from = process.cwd(),
  resourcesPath?: string
): VavServerEntry | null {
  const source = findVavServerScript(from)
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
  const bundled = res ? join(res, 'vav-server', 'vav-server.js') : ''
  if (bundled && existsSync(bundled)) {
    return { kind: 'bundle', path: bundled, root: dirname(bundled) }
  }
  const packed = join(from, 'packages', 'vav-server', 'vav-server.js')
  if (existsSync(packed)) {
    return { kind: 'bundle', path: packed, root: from }
  }
  return null
}

export function vavServerNodeArgs(entry: VavServerEntry, flags: string[]): string[] {
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
 * Prefer a real Node so `--import` / strip-types run vav-server, not another window.
 */
export function resolveNodeForVavServer(
  env: NodeJS.ProcessEnv = process.env,
  versions: { electron?: string } = process.versions
): { cmd: string; asNode: boolean } {
  if (!versions.electron) return { cmd: process.execPath, asNode: false }
  for (const candidate of [env.npm_node_execpath, env.NODE_BINARY]) {
    if (candidate && existsSync(candidate)) return { cmd: candidate, asNode: false }
  }
  // Packaged machines may have no `node` on PATH — run Electron as Node.
  return { cmd: process.execPath, asNode: true }
}

function registerHook(root: string): string {
  return pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href
}

export async function spawnLocalVavServer(
  options: SpawnLocalVavServerOptions = {}
): Promise<SpawnedVavServer> {
  const cwd = options.cwd ?? process.cwd()
  const entry = findVavServerEntry(cwd)
  if (!entry) {
    throw new Error(`vav-server not found from ${cwd} — run from the VAV repo, install the app bundle, or pass VAV_SERVER_URI`)
  }
  const root = entry.root
  const ephemeralState = !options.stateDir
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), 'vav-server-spawn-'))
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
  else {
    if (options.webPort != null) flags.push('--web-port', String(options.webPort))
    if (options.webListen) flags.push('--web-listen', options.webListen)
  }
  const args = vavServerNodeArgs(entry, flags)

  const node = resolveNodeForVavServer()
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(ephemeralState && !process.env.VAV_HOME && !options.extraEnv?.VAV_HOME
      ? { VAV_HOME: join(stateDir, 'vav-home') }
      : {}),
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

  const started = await waitForPairing(child)
  const payload = parseDaemonPairing(started.pairing)
  if (!payload) {
    child.kill('SIGTERM')
    throw new Error(`unrecognized vav-server pairing: ${started.pairing}`)
  }

  let stopped = false
  return {
    pairing: started.pairing,
    machineId: payload.machineId,
    name: payload.name,
    stateDir,
    webOrigin: parseWebOrigin(started.stdout),
    stop: () => {
      if (stopped) return
      stopped = true
      try {
        child.kill('SIGTERM')
      } catch {
        // Child stdio can already be gone (EIO on close).
      }
      if (ephemeralState) {
        try {
          rmSync(stateDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }
  }
}

function parseWebOrigin(stdout: string): string | undefined {
  const line = stdout.split('\n').find((row) => row.startsWith('vav-server web on '))
  const match = line?.match(/https?:\/\/\S+/)
  return match?.[0]
}

function waitForPairing(
  child: ChildProcess,
  timeoutMs = 12_000
): Promise<{ pairing: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderrTail = ''
    const timer = setTimeout(() => {
      reject(new Error(`vav-server did not print pairing.\n${stdout}\n${stderrTail}`))
    }, timeoutMs)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrTail += chunk
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      const line = stdout.split('\n').find((row) => isDaemonPairingLine(row))
      if (line) {
        clearTimeout(timer)
        resolve({ pairing: line.trim(), stdout })
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`vav-server exited ${code}: ${stderrTail || stdout}`))
    })
  })
}
