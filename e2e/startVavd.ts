import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDaemonPairing } from '../src/shared/daemonProtocol.ts'

const root = join(__dirname, '..')

export type VavdHandle = {
  pairing: string
  machineId: string
  name: string
  workspace: string
  stop: () => void
}

/**
 * Spawn headless `vavd` with a planted workspace file. Used by the remote
 * daemon e2e so the desktop app pairs against a real process, not a mock.
 */
export async function startVavd(): Promise<VavdHandle> {
  const base = process.platform === 'darwin' ? '/tmp' : tmpdir()
  const workspace = mkdtempSync(join(base, 'vav-e2e-remote-ws-'))
  const state = mkdtempSync(join(tmpdir(), 'vav-e2e-vavd-'))
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'remote-only.md'), 'planted by vavd e2e\n')
  mkdirSync(join(workspace, 'remote-pkg'))
  writeFileSync(join(workspace, 'remote-pkg', 'inside.md'), 'nested remote file\n')

  const child: ChildProcess = spawn(
    process.execPath,
    [
      '--import',
      join(root, 'scripts/register-shared-alias.mjs'),
      '--experimental-strip-types',
      join(root, 'src/main/daemon/vavd.ts'),
      '--port',
      '0',
      '--state',
      state,
      '--no-announce',
      '--no-web',
      '--name',
      'E2E Daemon'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: root }
  )

  let stdout = ''
  const pairing = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`vavd did not print pairing.\n${stdout}\n${stderrTail}`))
    }, 12_000)
    let stderrTail = ''
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

  const payload = parseDaemonPairing(pairing)
  if (!payload) throw new Error(`unrecognized vavd pairing: ${pairing}`)

  return {
    pairing,
    machineId: payload.machineId,
    name: payload.name,
    workspace,
    stop: () => {
      child.kill('SIGTERM')
      rmSync(state, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}
