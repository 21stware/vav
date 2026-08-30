/**
 * Live pipe: tailcatbridge listener → --dial → DaemonClient.
 * Skips when the sidecar binary is missing or DERP cannot be reached.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { drainJsonLines } from '../../shared/remoteControl.ts'
import { DaemonClient } from './DaemonClient.ts'
import { DaemonServer } from './DaemonServer.ts'

const SECRET = '0123456789abcdef01234567'
const BINARY = join(process.cwd(), 'resources', 'bin', process.platform === 'win32' ? 'tailcatbridge.exe' : 'tailcatbridge')

function spawnBridge(args: string[]): ChildProcess {
  return spawn(BINARY, args, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function waitReady(
  child: ChildProcess,
  pick: (event: Record<string, unknown>) => boolean,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      fail(new Error('sidecar ready timed out'))
    }, timeoutMs)
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      reject(err)
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      const { values, rest } = drainJsonLines(stdout)
      stdout = rest
      for (const value of values) {
        if (!value || typeof value !== 'object') continue
        const event = value as Record<string, unknown>
        if (!pick(event) || settled) continue
        settled = true
        clearTimeout(timer)
        resolve(event)
      }
    })
    child.stderr?.setEncoding('utf8')
    const errChunks: string[] = []
    child.stderr?.on('data', (chunk: string) => {
      errChunks.push(chunk)
    })
    child.on('error', fail)
    child.on('exit', (code) => {
      fail(new Error(`sidecar exited ${code}: ${errChunks.join('').trim()}`))
    })
  })
}

describe('tailcat daemon pipe', { skip: !existsSync(BINARY) }, () => {
  it('dials a daemon welcome over tailcatbridge --dial', { timeout: 90_000 }, async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-tc-'))
    const keyDir = await mkdtemp(join(tmpdir(), 'vav-tckey-'))
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'pipe' }),
      identity: { machineId: 'pipe-1', name: 'pipe' },
      secret: () => SECRET,
      appVersion: 'test',
      home: disk,
      tmp: disk
    })
    const daemonPort = await server.listen(0, '127.0.0.1')
    const listener = spawnBridge([
      '--key-file',
      join(keyDir, 'key.json'),
      '--forward',
      `127.0.0.1:${daemonPort}`
    ])
    const daemonClient = new DaemonClient()
    let dialer: ChildProcess | undefined
    try {
      const ready = await waitReady(
        listener,
        (event) => event.event === 'ready' && typeof event.token === 'string',
        60_000
      )
      const token = String(ready.token)
      dialer = spawnBridge(['--dial', token])
      const dialReady = await waitReady(
        dialer,
        (event) => event.event === 'ready' && typeof event.port === 'number',
        60_000
      )
      const welcome = await daemonClient.connect({
        host: '127.0.0.1',
        port: Number(dialReady.port),
        secret: SECRET,
        device: 'live-test',
        timeoutMs: 45_000
      })
      assert.equal(welcome.host.id, 'pipe-1')
      assert.equal(welcome.host.online, true)
    } finally {
      daemonClient.close()
      dialer?.stdin?.end()
      dialer?.kill()
      listener.stdin?.end()
      listener.kill()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(keyDir, { recursive: true, force: true })
    }
  })
})
