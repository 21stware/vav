import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { isDaemonPairingLine, parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import { connectPhone } from '../cli/vavPhoneClient.ts'

const execFileAsync = promisify(execFile)

const root = join(import.meta.dirname, '../../..')
/** `--import` needs a file:// URL on Windows (`D:` is not a valid scheme). */
const aliasHook = pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href

type RunningVavServer = {
  pairing: string
  host: string
  port: number
  secret: string
  webPort: number | null
  stop: () => Promise<void>
}

async function spawnVavServer(state: string): Promise<RunningVavServer> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '--import',
      aliasHook,
      '--experimental-strip-types',
      join(root, 'packages/vav-server/src/vav-server.ts'),
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
      'process-vav-server'
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
    const timer = setTimeout(() => reject(new Error(`vav-server did not start\n${stdout}\n${stderr}`)), 12_000)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      const line = stdout.split('\n').find((row) => isDaemonPairingLine(row))
      if (line) {
        clearTimeout(timer)
        resolve(line.trim())
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`vav-server exited ${code}: ${stderr || stdout}`))
    })
  })
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret || !parsed.port) throw new Error(`bad pairing: ${pairing}`)
  const webMatch = stdout.match(/vav-server web on http:\/\/127\.0\.0\.1:(\d+)/)
  return {
    pairing,
    host: parsed.host || '127.0.0.1',
    port: parsed.port,
    secret: parsed.secret,
    webPort: webMatch ? Number(webMatch[1]) : null,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode != null || child.signalCode != null) {
          resolve()
          return
        }
        const done = (): void => resolve()
        child.once('exit', done)
        child.kill('SIGTERM')
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* already gone */
          }
          resolve()
        }, 1_500).unref()
      })
  }
}

describe('vav-server process', () => {
  let dir = ''
  let daemon: RunningVavServer | null = null

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vav-server-proc-'))
    daemon = await spawnVavServer(dir)
  })

  after(async () => {
    await daemon?.stop()
    if (dir) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rm(dir, { recursive: true, force: true })
          break
        } catch (err) {
          if (attempt === 4) throw err
          await new Promise((resolve) => setTimeout(resolve, 150))
        }
      }
    }
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

      phone.send({ type: 'send', conversationId, text: 'hello from spawned vav-server' })
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

  it('accepts a phone send with a JPEG attachment', async () => {
    assert.ok(daemon)
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: daemon.port,
      secret: daemon.secret,
      device: 'process-photo'
    })
    try {
      phone.send({ type: 'create' })
      const createdFrames = await phone.waitNew((msg) => msg.type === 'created')
      const created = createdFrames.findLast((msg) => msg.type === 'created')
      assert.ok(created && created.type === 'created')
      phone.send({
        type: 'send',
        conversationId: created.session.id,
        text: '（附件）',
        images: [{ name: 'photo.jpg', mime: 'image/jpeg', data: 'abc' }]
      })
      const turns = await phone.waitNew(
        (msg) => msg.type === 'turn' && (msg.phase === 'start' || msg.phase === 'done' || msg.phase === 'error')
      )
      assert.ok(turns.some((msg) => msg.type === 'turn'))
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

  it('lets vav-board list and create sessions on the same vav-server', async () => {
    assert.ok(daemon)
    const created = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'session',
        'create',
        '--label',
        'from-vav-board',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const session = JSON.parse(created.stdout) as { id?: string; title?: string }
    assert.ok(session.id)
    const listed = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'session',
        'list',
        '--state',
        dir
      ],
      { cwd: root, timeout: 15_000 }
    )
    const rows = JSON.parse(listed.stdout) as Array<{ id?: string }>
    assert.ok(rows.some((row) => row.id === session.id))
  })

  it('lets vav-board pin, browse, read files, and run a pane on the same vav-server', async () => {
    assert.ok(daemon)
    const created = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'session',
        'create',
        '--label',
        'vav-board-control',
        '--cwd',
        dir,
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const session = JSON.parse(created.stdout) as { id?: string }
    assert.ok(session.id)

    const pinned = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'session',
        'pin',
        session.id,
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    assert.equal((JSON.parse(pinned.stdout) as { pinned?: boolean }).pinned, true)

    const host = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'host',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const info = JSON.parse(host.stdout) as { name?: string; home?: string }
    assert.ok(info.name)
    assert.ok(info.home)

    const listed = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'file',
        'list',
        dir,
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const files = JSON.parse(listed.stdout) as { entries?: Array<{ name?: string }> }
    assert.ok(Array.isArray(files.entries))

    const marker = join(dir, 'vav-board-marker.txt')
    await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'file',
        'write',
        marker,
        '--text',
        'written-by-vav-board',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const read = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'file',
        'read',
        marker,
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    assert.match((JSON.parse(read.stdout) as { text?: string }).text ?? '', /written-by-vav-board/)

    const browsed = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'workspace',
        'browse',
        session.id,
        dir,
        '--files',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const dirs = JSON.parse(browsed.stdout) as {
      type?: string
      entries?: Array<{ name?: string; isDirectory?: boolean }>
    }
    assert.equal(dirs.type, 'dirs')
    assert.ok(dirs.entries?.some((entry) => entry.name === 'vav-board-marker.txt' && entry.isDirectory === false))

    const pane = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-board/src/vav-board.ts'),
        'pane',
        'run',
        '--cwd',
        dir,
        '--timeout',
        '8000',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret,
        '--',
        'echo',
        'vav-board-pane'
      ],
      { cwd: root, timeout: 20_000 }
    )
    const ran = JSON.parse(pane.stdout) as { stream?: string; output?: string }
    assert.ok(ran.stream)
    assert.match(ran.output ?? '', /vav-board-pane/)
  })

  it('lets vav-tui print a turn on the same vav-server', async () => {
    assert.ok(daemon)
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-tui/src/vav-tui.ts'),
        '--mode',
        'json',
        '-p',
        'hello from vav-tui',
        '--host',
        '127.0.0.1',
        '--port',
        String(daemon.port),
        '--secret',
        daemon.secret
      ],
      { cwd: root, timeout: 15_000 }
    )
    const turn = JSON.parse(
      stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .at(-1) || stdout
    ) as {
      type?: string
      phase?: string
      draft?: string
    }
    assert.equal(turn.type, 'turn')
    assert.equal(turn.phase, 'done')
  })

  it('serves the web UI on loopback', async () => {
    assert.ok(daemon?.webPort)
    const health = await fetch(`http://127.0.0.1:${daemon.webPort}/health`)
    assert.equal(health.ok, true)
    assert.equal(((await health.json()) as { app: string }).app, 'vav-server')
    const discover = await fetch(`http://127.0.0.1:${daemon.webPort}/discover`)
    const info = (await discover.json()) as { app?: string; secret?: string; loopback?: boolean; port?: number }
    assert.equal(info.app, 'vav-server')
    assert.equal(info.loopback, true)
    assert.equal(info.secret, daemon.secret)
    assert.equal(info.port, daemon.port)
    const page = await fetch(`http://127.0.0.1:${daemon.webPort}/`)
    assert.equal(page.ok, true)
    const html = await page.text()
    assert.match(html, /VAV/)
    assert.match(html, /data-phone="web"/)
    assert.match(html, /phone\.js/)
    const script = await fetch(`http://127.0.0.1:${daemon.webPort}/phone.js`)
    assert.equal(script.ok, true)
    const js = await script.text()
    assert.match(js, /\/vav/)
    assert.match(js, /role:\s*['"]phone['"]/)
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

      phone.send({ type: 'compact', conversationId })
      const compactedFrames = await phone.waitNew((msg) => msg.type === 'compacted')
      const compacted = compactedFrames.findLast((msg) => msg.type === 'compacted')
      assert.ok(compacted && compacted.type === 'compacted')
      assert.equal(compacted.ok, false)
      assert.match(String(compacted.error ?? ''), /not enough|太少|Not enough/i)

      phone.send({ type: 'thread', conversationId })
      const threadFrames = await phone.waitNew((msg) => msg.type === 'thread')
      const thread = threadFrames.findLast((msg) => msg.type === 'thread')
      assert.ok(thread && thread.type === 'thread')
      const assistant = [...thread.messages].reverse().find((row) => row.role === 'assistant')
      assert.ok(assistant?.id)
      phone.send({ type: 'regenerate', conversationId, messageId: assistant.id })
      const again = await phone.waitNew(
        (msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error')
      )
      assert.ok(again.some((msg) => msg.type === 'turn' && msg.phase === 'done'))

      phone.send({ type: 'fork', conversationId, messageId: assistant.id })
      const forked = await phone.waitNew(
        (msg) =>
          (msg.type === 'thread' && msg.conversationId === conversationId) ||
          (msg.type === 'sent' && msg.conversationId === conversationId)
      )
      assert.ok(forked.some((msg) => msg.type === 'sent' || msg.type === 'thread'))

      phone.send({ type: 'leaf', conversationId, messageId: assistant.id, follow: true })
      const leafed = await phone.waitNew(
        (msg) =>
          (msg.type === 'thread' && msg.conversationId === conversationId) ||
          (msg.type === 'sent' && msg.conversationId === conversationId)
      )
      assert.ok(leafed.some((msg) => msg.type === 'sent' || msg.type === 'thread'))

      phone.send({ type: 'goal', conversationId, action: 'clear' })
      const goaledFrames = await phone.waitNew((msg) => msg.type === 'goaled')
      const goaled = goaledFrames.findLast((msg) => msg.type === 'goaled')
      assert.ok(goaled && goaled.type === 'goaled')
      assert.equal(goaled.ok, false)

      phone.send({ type: 'locate', conversationId, destinationDir: join(tmpdir(), 'vav-locate-e2e') })
      const locatedFrames = await phone.waitNew((msg) => msg.type === 'located')
      const located = locatedFrames.findLast((msg) => msg.type === 'located')
      assert.ok(located && located.type === 'located')
      assert.equal(typeof located.ok, 'boolean')
    } finally {
      phone.close()
    }
  })

  it('prints help and exits', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-server/src/vav-server.ts'),
        '--help'
      ],
      { cwd: root, timeout: 8_000 }
    )
    assert.match(stdout, /--web-port/)
    assert.match(stdout, /clients/)
    assert.match(stdout, /rotate-offer/)
  })

  it('starts without a web UI when --no-web is set', async () => {
    const state = await mkdtemp(join(tmpdir(), 'vav-server-noweb-'))
    const child = spawn(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-server/src/vav-server.ts'),
        '--listen',
        '127.0.0.1',
        '--port',
        '0',
        '--state',
        state,
        '--no-announce',
        '--no-web',
        '--name',
        'no-web'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: root, env: { ...process.env, VAV_E2E: '1', VAV_E2E_STUB_TURN: '1' } }
    )
    let stdout = ''
    try {
      const pairing = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`silent\n${stdout}`)), 12_000)
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk
          const line = stdout.split('\n').find((row) => isDaemonPairingLine(row))
          if (line) {
            clearTimeout(timer)
            resolve(line.trim())
          }
        })
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`exited ${code}: ${stdout}`))
        })
      })
      assert.match(pairing, /^vavrtp:/)
      assert.equal(stdout.includes('vav-server web on'), false)
    } finally {
      child.kill('SIGTERM')
      await rm(state, { recursive: true, force: true })
    }
  })

  it('lists and rotates grants from the CLI without starting a listen', async () => {
    const state = await mkdtemp(join(tmpdir(), 'vav-server-cli-admin-'))
    try {
      const empty = await execFileAsync(
        process.execPath,
        [
          '--import',
          aliasHook,
          '--experimental-strip-types',
          join(root, 'packages/vav-server/src/vav-server.ts'),
          '--state',
          state,
          'clients'
        ],
        { cwd: root, timeout: 8_000 }
      )
      assert.match(empty.stdout, /no paired computers/)

      const { createFileGrantStore } = await import('./grants.ts')
      const grant = createFileGrantStore(state).issue({ clientId: 'cli', name: 'CLI Box' })
      const listed = await execFileAsync(
        process.execPath,
        [
          '--import',
          aliasHook,
          '--experimental-strip-types',
          join(root, 'packages/vav-server/src/vav-server.ts'),
          '--state',
          state,
          'clients'
        ],
        { cwd: root, timeout: 8_000 }
      )
      assert.match(listed.stdout, /CLI Box/)

      const unpaired = await execFileAsync(
        process.execPath,
        [
          '--import',
          aliasHook,
          '--experimental-strip-types',
          join(root, 'packages/vav-server/src/vav-server.ts'),
          '--state',
          state,
          'unpair',
          grant.id
        ],
        { cwd: root, timeout: 8_000 }
      )
      assert.match(unpaired.stdout, /unpaired/)

      const rotated = await execFileAsync(
        process.execPath,
        [
          '--import',
          aliasHook,
          '--experimental-strip-types',
          join(root, 'packages/vav-server/src/vav-server.ts'),
          '--state',
          state,
          'rotate-offer'
        ],
        { cwd: root, timeout: 8_000 }
      )
      assert.match(rotated.stdout, /rotated offer/)

      const disconnected = await execFileAsync(
        process.execPath,
        [
          '--import',
          aliasHook,
          '--experimental-strip-types',
          join(root, 'packages/vav-server/src/vav-server.ts'),
          '--state',
          state,
          'disconnect',
          'g1'
        ],
        { cwd: root, timeout: 8_000 }
      )
      assert.match(disconnected.stdout, /not running/)
    } finally {
      await rm(state, { recursive: true, force: true })
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

  it('lets a daemon-role web socket list a planted file', async () => {
    assert.ok(daemon?.webPort)
    const planted = join(dir, 'remote-ws.md')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(planted, 'planted for chrome daemon ws')
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.webPort}/vav`)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('ws error')))
    })
    try {
      const next = (until: (raw: { type?: string; ok?: boolean; id?: string }) => boolean) =>
        new Promise<unknown[]>((resolve, reject) => {
          const got: unknown[] = []
          const timer = setTimeout(() => reject(new Error('ws timeout')), 8000)
          const onMsg = (event: MessageEvent): void => {
            for (const line of String(event.data).split('\n').filter(Boolean)) {
              const raw = JSON.parse(line) as { type?: string; ok?: boolean; id?: string }
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
      ws.send(
        JSON.stringify({ type: 'hello', proto: 1, auth: daemon.secret, role: 'daemon', device: 'chrome' })
      )
      await next((raw) => raw.type === 'welcome')
      ws.send(JSON.stringify({ type: 'req', id: 'r1', method: 'fs.readdir', params: { path: dir } }))
      const frames = (await next((raw) => raw.type === 'res' && raw.id === 'r1')) as Array<{
        type?: string
        ok?: boolean
        result?: { entries?: Array<{ name?: string; isDirectory?: boolean }> }
      }>
      const res = frames.find((row) => row.type === 'res')
      assert.equal(res?.ok, true)
      assert.ok(res?.result?.entries?.some((entry) => entry.name === 'remote-ws.md' && entry.isDirectory === false))

      ws.send(
        JSON.stringify({
          type: 'req',
          id: 'r2',
          method: 'fileSessions.open',
          params: { path: planted }
        })
      )
      const openedFrames = (await next((raw) => raw.type === 'res' && raw.id === 'r2')) as Array<{
        type?: string
        ok?: boolean
        id?: string
        result?: { fileId?: string; activeSessionId?: string; sessions?: unknown[] }
      }>
      const opened = openedFrames.find((row) => row.type === 'res' && row.id === 'r2')
      assert.equal(opened?.ok, true)
      assert.ok(opened?.result?.fileId)
      assert.ok(opened?.result?.activeSessionId)
    } finally {
      ws.close()
    }
  })
})
