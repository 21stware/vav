import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { connectPhone } from '../cli/vavPhoneClient.ts'

const execFileAsync = promisify(execFile)

const root = join(import.meta.dirname, '../../..')

type RunningVavd = {
  pairing: string
  host: string
  port: number
  secret: string
  webPort: number | null
  stop: () => void
}

async function spawnVavd(state: string): Promise<RunningVavd> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '--import',
      join(root, 'scripts/register-shared-alias.mjs'),
      '--experimental-strip-types',
      join(root, 'src/main/daemon/vavd.ts'),
      '--listen',
      '127.0.0.1',
      '--port',
      '0',
      '--web-port',
      '0',
      '--web-listen',
      '127.0.0.1',
      '--state',
      state,
      '--no-announce',
      '--name',
      'process-vavd'
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
      env: {
        ...process.env,
        VAV_E2E: '1',
        VAV_E2E_STUB_TURN: '1'
      }
    }
  )
  let stdout = ''
  let stderr = ''
  const pairing = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vavd did not start\n${stdout}\n${stderr}`)), 12_000)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
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
      reject(new Error(`vavd exited ${code}: ${stderr || stdout}`))
    })
  })
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret || !parsed.port) throw new Error(`bad pairing: ${pairing}`)
  const webMatch = stdout.match(/vavd web on http:\/\/127\.0\.0\.1:(\d+)/)
  return {
    pairing,
    host: parsed.host || '127.0.0.1',
    port: parsed.port,
    secret: parsed.secret,
    webPort: webMatch ? Number(webMatch[1]) : null,
    stop: () => {
      child.kill('SIGTERM')
    }
  }
}

describe('vavd process', () => {
  let dir = ''
  let daemon: RunningVavd | null = null

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vavd-proc-'))
    daemon = await spawnVavd(dir)
  })

  after(async () => {
    daemon?.stop()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('starts a local service a phone client can pair, send, and configure', async () => {
    assert.ok(daemon)
    assert.equal(daemon.host, '127.0.0.1')
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: daemon.port,
      secret: daemon.secret,
      device: 'process-test'
    })
    try {
      assert.ok(phone.frames.some((msg) => msg.type === 'welcome'))
      phone.send({ type: 'create' })
      const createdFrames = await phone.waitNew((msg) => msg.type === 'created')
      const created = createdFrames.findLast((msg) => msg.type === 'created')
      assert.ok(created && created.type === 'created')
      const conversationId = created.session.id

      phone.send({ type: 'send', conversationId, text: 'hello from spawned vavd' })
      const turns = await phone.waitNew(
        (msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error')
      )
      assert.ok(turns.some((msg) => msg.type === 'turn' && msg.phase === 'done'))

      phone.send({ type: 'configure', conversationId, approvalMode: 'edit' })
      const controls = await phone.waitNew((msg) => msg.type === 'controls' && msg.conversationId === conversationId)
      const row = controls.findLast((msg) => msg.type === 'controls')
      assert.ok(row && row.type === 'controls')
      assert.equal(row.approval, 'edit')
    } finally {
      phone.close()
    }
  })

  it('lets the vav CLI send a turn over the same phone protocol', async () => {
    assert.ok(daemon)
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        join(root, 'scripts/register-shared-alias.mjs'),
        '--experimental-strip-types',
        join(root, 'src/main/cli/vavRemoteCli.ts'),
        'send',
        'hello from vav cli',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const payload = JSON.parse(stdout) as { session?: string; turn?: { type?: string; phase?: string } }
    assert.ok(payload.session)
    assert.equal(payload.turn?.type, 'turn')
    assert.equal(payload.turn?.phase, 'done')
  })

  it('serves the web UI on loopback', async () => {
    assert.ok(daemon?.webPort)
    const health = await fetch(`http://127.0.0.1:${daemon.webPort}/health`)
    assert.equal(health.ok, true)
    assert.equal(((await health.json()) as { app: string }).app, 'vavd')
    const page = await fetch(`http://127.0.0.1:${daemon.webPort}/`)
    assert.equal(page.ok, true)
    const html = await page.text()
    assert.match(html, /VAV/)
    assert.match(html, /\/vav/)
  })
})
