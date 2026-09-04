import assert from 'node:assert/strict'
import { createConnection } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { HostRegistry, createLocalWorkspaceHost } from './WorkspaceHost.ts'
import { createVavControlPlane } from './VavControlPlane.ts'
import { DaemonServer } from '../daemon/DaemonServer.ts'
import { DaemonAttachService } from '../daemon/DaemonAttachService.ts'
import { startVavWebBridge } from '../daemon/VavWebBridge.ts'
import { DAEMON_PROTO_VERSION, encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import { encodeLine, parseServerMessage, type RemoteServerMessage } from '../../shared/remoteControl.ts'

const SECRET = '0123456789abcdef01234567'

async function readFrames(
  socket: { setEncoding: (enc: string) => void; on: (ev: string, fn: (chunk: string) => void) => void },
  until: (msg: RemoteServerMessage) => boolean,
  timeoutMs = 4000
): Promise<RemoteServerMessage[]> {
  socket.setEncoding('utf8')
  const got: RemoteServerMessage[] = []
  let buf = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout; saw ${got.map((m) => m.type).join(',')}`)), timeoutMs)
    socket.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        const parsed = parseServerMessage(JSON.parse(line) as unknown)
        if (!parsed) continue
        got.push(parsed)
        if (until(parsed)) {
          clearTimeout(timer)
          resolve(got)
        }
      }
    })
  })
}

describe('VavControlPlane', () => {
  const prevE2e = process.env.VAV_E2E
  const prevStub = process.env.VAV_E2E_STUB_TURN

  before(() => {
    process.env.VAV_E2E = '1'
    process.env.VAV_E2E_STUB_TURN = '1'
  })

  after(() => {
    if (prevE2e === undefined) delete process.env.VAV_E2E
    else process.env.VAV_E2E = prevE2e
    if (prevStub === undefined) delete process.env.VAV_E2E_STUB_TURN
    else process.env.VAV_E2E_STUB_TURN = prevStub
  })

  it('accepts phone hello, creates a session, and runs the agent loop in-process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-plane-'))
    const host = createLocalWorkspaceHost({ name: 'plane' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const server = new DaemonServer({
      host,
      identity: { machineId: 'plane-box', name: 'plane' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      catalog: plane.catalog,
      onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
    })
    const port = await server.listen(0, '127.0.0.1')
    const phone = createConnection({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      phone.once('connect', resolve)
      phone.once('error', reject)
    })
    try {
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, role: 'phone', device: 'test-phone' }))
      const welcomed = await readFrames(phone, (msg) => msg.type === 'welcome')
      assert.equal(welcomed.some((m) => m.type === 'welcome'), true)

      phone.write(encodeLine({ type: 'create' }))
      const created = await readFrames(phone, (msg) => msg.type === 'created')
      const createdMsg = created.find((m) => m.type === 'created')
      assert.ok(createdMsg && createdMsg.type === 'created')
      const conversationId = createdMsg.session.id

      phone.write(encodeLine({ type: 'send', conversationId, text: 'hello from phone' }))
      const turns = await readFrames(
        phone,
        (msg) => msg.type === 'turn' && (msg.phase === 'done' || msg.phase === 'error')
      )
      const done = turns.find((m) => m.type === 'turn' && m.phase === 'done')
      assert.ok(done, 'agent turn must finish inside vavd')
      const stored = plane.conversations.get(conversationId)
      assert.ok(stored)
      assert.ok(stored.messages.some((m) => m.role === 'user'))
      assert.ok(stored.messages.some((m) => m.role === 'assistant'))

      phone.write(encodeLine({ type: 'configure', conversationId, approvalMode: 'edit', model: 'test-model' }))
      const configured = await readFrames(phone, (msg) => msg.type === 'controls' && msg.conversationId === conversationId)
      const controls = configured.find((m) => m.type === 'controls')
      assert.ok(controls && controls.type === 'controls')
      assert.equal(controls.approval, 'edit')
      assert.equal(controls.model, 'test-model')
      phone.write(encodeLine({ type: 'configure', conversationId, agent: 'claude' }))
      const locked = await readFrames(phone, (msg) => msg.type === 'error')
      assert.ok(locked.some((m) => m.type === 'error'))
    } finally {
      phone.destroy()
      plane.dispose()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('parks a tool approval on the host and finishes after the client replies', async () => {
    process.env.VAV_E2E_STUB_APPROVE = '1'
    const dir = await mkdtemp(join(tmpdir(), 'vav-approve-'))
    const host = createLocalWorkspaceHost({ name: 'approve' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const server = new DaemonServer({
      host,
      identity: { machineId: 'approve-box', name: 'approve' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      catalog: plane.catalog,
      onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
    })
    const port = await server.listen(0, '127.0.0.1')
    const phone = createConnection({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      phone.once('connect', resolve)
      phone.once('error', reject)
    })
    try {
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, role: 'phone', device: 'test-phone' }))
      await readFrames(phone, (msg) => msg.type === 'welcome')
      phone.write(encodeLine({ type: 'create' }))
      const created = await readFrames(phone, (msg) => msg.type === 'created')
      const createdMsg = created.find((m) => m.type === 'created')
      assert.ok(createdMsg && createdMsg.type === 'created')
      const conversationId = createdMsg.session.id
      phone.write(encodeLine({ type: 'send', conversationId, text: 'write hello.md' }))
      const awaiting = await readFrames(phone, (msg) => msg.type === 'turn' && msg.phase === 'awaiting')
      const card = awaiting.find((m) => m.type === 'turn' && m.phase === 'awaiting')
      assert.ok(card && card.type === 'turn')
      const toolCallId = card.awaiting?.id
      assert.ok(toolCallId)
      phone.write(encodeLine({ type: 'reply', conversationId, toolCallId, answer: 'Approve' }))
      const done = await readFrames(phone, (msg) => msg.type === 'turn' && msg.phase === 'done')
      assert.ok(done.some((m) => m.type === 'turn' && m.phase === 'done'))
      const conversation = plane.conversations.get(conversationId)
      assert.ok(conversation?.workingDirectory)
      const written = await readFile(join(conversation.workingDirectory, 'hello.md'), 'utf8')
      assert.equal(written, 'patched\n')
    } finally {
      delete process.env.VAV_E2E_STUB_APPROVE
      phone.destroy()
      plane.dispose()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('streams reasoning and a tool card before the turn ends', async () => {
    process.env.VAV_E2E_STUB_STREAM = '1'
    const dir = await mkdtemp(join(tmpdir(), 'vav-stream-'))
    const host = createLocalWorkspaceHost({ name: 'stream' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const server = new DaemonServer({
      host,
      identity: { machineId: 'stream-box', name: 'stream' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      catalog: plane.catalog,
      onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
    })
    const port = await server.listen(0, '127.0.0.1')
    const phone = createConnection({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      phone.once('connect', resolve)
      phone.once('error', reject)
    })
    try {
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, role: 'phone', device: 'test-phone' }))
      await readFrames(phone, (msg) => msg.type === 'welcome')
      phone.write(encodeLine({ type: 'create' }))
      const created = await readFrames(phone, (msg) => msg.type === 'created')
      const createdMsg = created.find((m) => m.type === 'created')
      assert.ok(createdMsg && createdMsg.type === 'created')
      const conversationId = createdMsg.session.id
      phone.write(encodeLine({ type: 'send', conversationId, text: 'stream please' }))
      const frames = await readFrames(phone, (msg) => msg.type === 'turn' && msg.phase === 'done')
      assert.ok(
        frames.some(
          (m) =>
            m.type === 'turn' &&
            (m.thinking || m.blocks?.some((b) => b.kind === 'reasoning'))
        ),
        'live thinking must reach the client'
      )
      assert.ok(
        frames.some(
          (m) => m.type === 'turn' && m.blocks?.some((b) => b.kind === 'tool' && b.tool === 'fs_read')
        ),
        'tool card must stream on the control plane'
      )
      assert.ok(frames.some((m) => m.type === 'turn' && m.phase === 'done'))
    } finally {
      delete process.env.VAV_E2E_STUB_STREAM
      phone.destroy()
      plane.dispose()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lets the desktop attach client run a turn on the plane', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-attach-plane-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-client-'))
    const host = createLocalWorkspaceHost({ name: 'box' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const server = new DaemonServer({
      host,
      identity: { machineId: 'box-1', name: 'box' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      catalog: plane.catalog,
      onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
    })
    const port = await server.listen(0, '127.0.0.1')
    const service = new DaemonAttachService({
      userData,
      registry: new HostRegistry(),
      identityName: 'desktop-ui',
      secret: () => SECRET,
      appVersion: 'test',
      enabled: () => false,
      tailcatToken: () => null,
      onHostsChanged: () => undefined
    })
    try {
      const result = await service.pair(
        encodeDaemonPairing({
          v: DAEMON_PROTO_VERSION,
          secret: SECRET,
          machineId: 'ignored',
          name: 'box',
          host: '127.0.0.1',
          port
        })
      )
      assert.equal(result.ok, true)
      assert.equal(service.controlPlaneOf('box-1'), true)
      const dial = service.controlOf('box-1')
      assert.ok(dial)
      const conversationId = await dial.createSession()
      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('desktop attach saw no turn')), 4000)
        dial.onFrame((_state, msg) => {
          if (msg.type === 'turn' && msg.phase === 'done' && msg.conversationId === conversationId) {
            clearTimeout(timer)
            resolve()
          }
        })
      })
      dial.send(conversationId, 'hello from desktop connect')
      await finished
      const stored = plane.conversations.get(conversationId)
      assert.ok(stored)
      assert.ok(stored.messages.some((m) => m.role === 'user'))
      assert.ok(stored.messages.some((m) => m.role === 'assistant'))
      dial.configure(conversationId, { approvalMode: 'edit', model: 'desktop-model' })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no controls')), 4000)
        dial.onFrame((_state, msg) => {
          if (msg.type === 'controls' && msg.conversationId === conversationId) {
            clearTimeout(timer)
            assert.equal(msg.approval, 'edit')
            assert.equal(msg.model, 'desktop-model')
            resolve()
          }
        })
      })
    } finally {
      service.dispose()
      plane.dispose()
      server.close()
      await rm(dir, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('serves a web socket that speaks the same phone protocol', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-web-'))
    const host = createLocalWorkspaceHost({ name: 'web' })
    const plane = createVavControlPlane({
      stateDir: dir,
      host,
      secret: () => SECRET,
      appVersion: 'test'
    })
    plane.load()
    const web = await startVavWebBridge({
      listen: '127.0.0.1',
      port: 0,
      hub: plane.hub,
      secret: () => SECRET
    })
    try {
      const health = await fetch(`http://127.0.0.1:${web.port}/health`)
      assert.equal(health.ok, true)
      assert.equal(((await health.json()) as { app: string }).app, 'vavd')

      const ws = new WebSocket(`ws://127.0.0.1:${web.port}/vav`)
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve())
        ws.addEventListener('error', () => reject(new Error('ws error')))
      })
      const frames: RemoteServerMessage[] = []
      const gotWelcome = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no welcome')), 4000)
        ws.addEventListener('message', (event) => {
          for (const line of String(event.data).split('\n').filter(Boolean)) {
            const parsed = parseServerMessage(JSON.parse(line) as unknown)
            if (!parsed) continue
            frames.push(parsed)
            if (parsed.type === 'welcome') {
              clearTimeout(timer)
              resolve()
            }
          }
        })
      })
      ws.send(JSON.stringify({ type: 'hello', proto: 1, auth: SECRET, role: 'phone', device: 'web' }))
      await gotWelcome
      assert.ok(frames.some((m) => m.type === 'welcome'))
      const created = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no created')), 4000)
        ws.addEventListener('message', (event) => {
          for (const line of String(event.data).split('\n').filter(Boolean)) {
            const parsed = parseServerMessage(JSON.parse(line) as unknown)
            if (parsed?.type === 'created') {
              clearTimeout(timer)
              resolve(parsed.session.id)
            }
          }
        })
      })
      ws.send(JSON.stringify({ type: 'create' }))
      const conversationId = await created
      const configured = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no controls')), 4000)
        ws.addEventListener('message', (event) => {
          for (const line of String(event.data).split('\n').filter(Boolean)) {
            const parsed = parseServerMessage(JSON.parse(line) as unknown)
            if (parsed?.type === 'controls' && parsed.conversationId === conversationId) {
              clearTimeout(timer)
              assert.equal(parsed.approval, 'edit')
              resolve()
            }
          }
        })
      })
      ws.send(JSON.stringify({ type: 'configure', conversationId, approvalMode: 'edit' }))
      await configured
      ws.close()
    } finally {
      web.close()
      plane.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
