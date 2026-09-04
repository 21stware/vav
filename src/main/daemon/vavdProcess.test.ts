import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { connectPhone } from '../cli/vavPhoneClient.ts'

const execFileAsync = promisify(execFile)

const root = join(import.meta.dirname, '../../..')
/** `--import` needs a file:// URL on Windows (`D:` is not a valid scheme). */
const aliasHook = pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href

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
      aliasHook,
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

async function runVavd(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  stdout: string
  stderr: string
  code: number | null
}> {
  const child = spawn(process.execPath, [
    '--import',
    aliasHook,
    '--experimental-strip-types',
    join(root, 'src/main/daemon/vavd.ts'),
    ...args
  ], {
    cwd: root,
    env: { ...process.env, ...env }
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (value) => resolve(value))
  })
  return { stdout, stderr, code }
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

  it('prints help and version without starting a listen', async () => {
    const help = await runVavd(['--help'])
    assert.equal(help.code, 0)
    assert.match(help.stdout, /--port/)
    assert.match(help.stdout, /rotate-offer/)
    const version = await runVavd(['--version'], { npm_package_version: '1.19.0' })
    assert.equal(version.code, 0)
    assert.match(version.stdout, /vavd 1\.19\.0/)
    const bad = await runVavd(['--port', 'nope'])
    assert.equal(bad.code, 1)
    assert.match(bad.stderr, /--port/)
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
        aliasHook,
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

  it('accepts an iOS-style hello with no role, then send and configure', async () => {
    assert.ok(daemon)
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: daemon.port,
      secret: daemon.secret,
      device: 'iPhone',
      omitRole: true
    })
    try {
      phone.send({ type: 'create' })
      const createdFrames = await phone.waitNew((msg) => msg.type === 'created')
      const created = createdFrames.findLast((msg) => msg.type === 'created')
      assert.ok(created && created.type === 'created')
      const conversationId = created.session.id
      phone.send({
        type: 'configure',
        conversationId,
        model: 'ios-model',
        approvalMode: 'bypass'
      })
      const controls = await phone.waitNew((msg) => msg.type === 'controls')
      const row = controls.findLast((msg) => msg.type === 'controls')
      assert.ok(row && row.type === 'controls')
      assert.equal(row.model, 'ios-model')
      assert.equal(row.approval, 'bypass')
      phone.send({ type: 'send', conversationId, text: 'hello from iOS remote' })
      const turns = await phone.waitNew(
        (msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error')
      )
      assert.ok(turns.some((msg) => msg.type === 'turn' && msg.phase === 'done'))
    } finally {
      phone.close()
    }
  })

  it('lets a Chrome-role web socket send and configure a model', async () => {
    assert.ok(daemon?.webPort)
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.webPort}/vav`)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('ws error')))
    })
    try {
      const next = (until: (raw: { type?: string; phase?: string; conversationId?: string }) => boolean) =>
        new Promise<unknown[]>((resolve, reject) => {
          const got: unknown[] = []
          const timer = setTimeout(() => reject(new Error('ws timeout')), 8000)
          const onMsg = (event: MessageEvent): void => {
            for (const line of String(event.data).split('\n').filter(Boolean)) {
              const raw = JSON.parse(line) as { type?: string; phase?: string; conversationId?: string }
              got.push(raw)
              if (until(raw)) {
                clearTimeout(timer)
                ws.removeEventListener('message', onMsg)
                resolve(got)
              }
            }
          }
          ws.addEventListener('message', onMsg)
        })
      ws.send(JSON.stringify({ type: 'hello', proto: 1, auth: daemon.secret, role: 'phone', device: 'chrome' }))
      await next((raw) => raw.type === 'welcome')
      ws.send(JSON.stringify({ type: 'create' }))
      const created = (await next((raw) => raw.type === 'created')) as Array<{
        type?: string
        session?: { id?: string }
      }>
      const conversationId = created.find((row) => row.type === 'created')?.session?.id
      assert.ok(conversationId)
      ws.send(
        JSON.stringify({
          type: 'configure',
          conversationId,
          model: 'process-chrome-model',
          approvalMode: 'bypass'
        })
      )
      const controls = (await next(
        (raw) => raw.type === 'controls' && raw.conversationId === conversationId
      )) as Array<{ type?: string; model?: string; approval?: string }>
      const row = controls.find((item) => item.type === 'controls')
      assert.equal(row?.model, 'process-chrome-model')
      assert.equal(row?.approval, 'bypass')
      ws.send(JSON.stringify({ type: 'send', conversationId, text: 'hello from chrome ws' }))
      const turns = (await next(
        (raw) => raw.type === 'turn' && raw.phase === 'done' && raw.conversationId === conversationId
      )) as Array<{ type?: string; phase?: string }>
      assert.ok(turns.some((item) => item.type === 'turn' && item.phase === 'done'))
    } finally {
      ws.close()
    }
  })

  it('prints a new pairing URI from rotate-offer on the live admin port', async () => {
    assert.ok(daemon)
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'src/main/daemon/vavd.ts'),
        '--state',
        dir,
        'rotate-offer'
      ],
      { cwd: root, timeout: 8_000 }
    )
    assert.match(stdout, /^vav-daemon:/)
    const parsed = parseDaemonPairing(stdout.trim().split('\n')[0] ?? '')
    assert.ok(parsed?.secret)
    assert.notEqual(parsed.secret, daemon.secret)
  })

  it('rejects a DNS-rebinding Host header on the loopback web UI', async () => {
    assert.ok(daemon?.webPort)
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: daemon.webPort ?? 0,
          path: '/health',
          headers: { Host: 'evil.example' }
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 421)
  })

  it('prints vav CLI help without connecting', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'src/main/cli/vavRemoteCli.ts'),
        '--help'
      ],
      { cwd: root, timeout: 8_000 }
    )
    assert.match(stdout, /vav send/)
    assert.match(stdout, /vav cancel/)
  })
})
