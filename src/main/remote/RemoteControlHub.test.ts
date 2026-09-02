import assert from 'node:assert/strict'
import { createConnection, type Socket } from 'node:net'
import { describe, it } from 'node:test'
import { createServer } from 'node:net'
import {
  encodeLine,
  parseServerMessage,
  type RemoteHostEvent,
  type RemoteSession,
  type RemoteThreadEvent
} from '../../shared/remoteControl.ts'
import { applyRemoteServerMessage, emptyRemoteControlSession } from '../../shared/remoteControlSession.ts'
import { RemoteControlHub } from './RemoteControlHub.ts'
import { REMOTE_PHONE_CAPABILITIES } from '../../shared/remoteControl.ts'

const SECRET = '0123456789abcdef0123'

function hostEvent(): RemoteHostEvent {
  return {
    type: 'host',
    name: 'Host',
    home: '/home',
    tmp: '/tmp',
    capabilities: REMOTE_PHONE_CAPABILITIES,
    defaults: { agent: 'vav', model: 'm', thinking: null, approval: 'auto' },
    recentDirs: []
  }
}

async function listenHub(
  sent: string[]
): Promise<{ hub: RemoteControlHub; port: number; close: () => void }> {
  const sessions: RemoteSession[] = [
    {
      id: 'c1',
      title: 'Host chat',
      dirLabel: '~/proj',
      status: 'idle',
      surface: 'vav',
      updatedAt: 1,
      preview: 'note'
    }
  ]
  const threads = new Map<string, RemoteThreadEvent>([
    [
      'c1',
      {
        type: 'thread',
        conversationId: 'c1',
        messages: [{ id: 'u1', role: 'user', text: 'note', at: 1 }]
      }
    ]
  ])
  const hub = new RemoteControlHub({
    appVersion: 'test',
    secret: () => SECRET,
    listSessions: () => sessions,
    listThread: (id) => threads.get(id) ?? null,
    listControls: () => null,
    listHost: hostEvent,
    configure: (message) => {
      sent.push(`configure:${message.conversationId}:${message.approvalMode ?? ''}`)
      return 'ok'
    },
    sendMessage: (id, text) => {
      sent.push(`${id}:${text}`)
      const thread = threads.get(id)
      if (thread) {
        thread.messages = [
          ...thread.messages,
          { id: `u-${thread.messages.length}`, role: 'user', text, at: Date.now() }
        ]
      }
      return 'ok'
    },
    createSession: () => {
      const session: RemoteSession = {
        id: 'c-new',
        title: 'New session',
        dirLabel: '',
        status: 'idle',
        surface: 'vav',
        updatedAt: Date.now()
      }
      sessions.unshift(session)
      return session
    },
    cancel: () => 'ok',
    reply: () => true,
    rename: () => 'ok',
    archive: () => 'ok',
    browse: () => 'not-found',
    setWorkspace: () => 'ok'
  })
  const server = createServer((socket) => hub.attach(socket))
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('no port'))
      else resolve(address.port)
    })
  })
  return {
    hub,
    port,
    close: () => {
      hub.dispose()
      server.close()
    }
  }
}

async function readUntil(
  socket: Socket,
  match: (state: ReturnType<typeof emptyRemoteControlSession>) => boolean
): Promise<ReturnType<typeof emptyRemoteControlSession>> {
  let buffer = ''
  let state = emptyRemoteControlSession()
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for control frames')), 3_000)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const parsed = parseServerMessage(JSON.parse(line) as unknown)
        if (parsed) state = applyRemoteServerMessage(state, parsed)
        if (match(state)) {
          clearTimeout(timer)
          resolve(state)
        }
      }
    })
    socket.on('error', reject)
  })
}

describe('RemoteControlHub', () => {
  it('rejects a bad secret and accepts a phone hello', async () => {
    const sent: string[] = []
    const { port, close } = await listenHub(sent)
    try {
      const bad = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        bad.once('connect', resolve)
        bad.once('error', reject)
      })
      bad.write(encodeLine({ type: 'hello', proto: 1, auth: 'nope', device: 'phone' }))
      const err = await new Promise<string>((resolve, reject) => {
        let buf = ''
        bad.setEncoding('utf8')
        bad.on('data', (chunk: string) => {
          buf += chunk
          if (buf.includes('\n')) {
            const parsed = parseServerMessage(JSON.parse(buf.trim()) as unknown)
            if (parsed?.type === 'error') resolve(parsed.code)
          }
        })
        bad.on('error', reject)
      })
      assert.equal(err, 'auth')
      bad.destroy()

      const phone = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        phone.once('connect', resolve)
        phone.once('error', reject)
      })
      phone.write(
        encodeLine({ type: 'hello', proto: 1, auth: SECRET, device: 'iPhone', role: 'phone' })
      )
      const state = await readUntil(phone, (s) => s.welcomed && s.sessions.length === 1 && s.host !== null)
      assert.equal(state.app, 'VAV')
      assert.equal(state.sessions[0]?.id, 'c1')
      assert.equal(state.host?.name, 'Host')
      phone.destroy()
    } finally {
      close()
    }
  })

  it('runs send on the host and fans the thread — the control UI is a projection', async () => {
    const sent: string[] = []
    const { hub, port, close } = await listenHub(sent)
    try {
      const phone = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        phone.once('connect', resolve)
        phone.once('error', reject)
      })
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, device: 'iPhone' }))
      await readUntil(phone, (s) => s.welcomed)
      phone.write(encodeLine({ type: 'send', conversationId: 'c1', text: 'from phone' }))
      const after = await readUntil(
        phone,
        (s) => s.threads.c1?.some((m) => m.text === 'from phone') === true
      )
      assert.deepEqual(sent, ['c1:from phone'])
      assert.ok(after.threads.c1?.some((m) => m.role === 'user' && m.text === 'from phone'))

      hub.beginLive('c1')
      hub.appendLive('c1', 0, 'text', 'e2e stub reply')
      const live = await readUntil(phone, (s) => s.generatingIds.includes('c1') && s.drafts.c1 === 'e2e stub reply')
      assert.equal(live.drafts.c1, 'e2e stub reply')

      phone.write(
        encodeLine({ type: 'configure', conversationId: 'c1', approvalMode: 'bypass' })
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.ok(sent.includes('configure:c1:bypass'))
      phone.destroy()
    } finally {
      close()
    }
  })

  it('hands a daemon-role hello to the workspace host, not the session plane', async () => {
    let handed: string | null = null
    const hub = new RemoteControlHub({
      appVersion: 'test',
      secret: () => SECRET,
      listSessions: () => [],
      listThread: () => null,
      listControls: () => null,
      listHost: hostEvent,
      configure: () => 'ok',
      sendMessage: () => 'ok',
      createSession: () => {
        throw new Error('unused')
      },
      cancel: () => 'ok',
      reply: () => false,
      rename: () => 'ok',
      archive: () => 'ok',
      browse: () => 'not-found',
      setWorkspace: () => 'ok',
      onDaemonHello: (_socket, leftover) => {
        handed = leftover
      }
    })
    const server = createServer((socket) => hub.attach(socket))
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
    try {
      const socket = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      socket.write(
        encodeLine({ type: 'hello', proto: 1, auth: SECRET, role: 'daemon', device: 'vavd' })
      )
      await new Promise((resolve) => setTimeout(resolve, 80))
      assert.equal(handed, '')
      assert.equal(hub.authedClients().length, 0)
      socket.destroy()
    } finally {
      hub.dispose()
      server.close()
    }
  })
})
