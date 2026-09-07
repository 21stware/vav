import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REMOTE_PHONE_CAPABILITIES } from '@shared/remoteControl.ts'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost.ts'
import type { PhoneLine, PhoneTransport } from './phoneTransport.ts'
import {
  assessSurfaceRgba,
  discoverPeerFromInfo,
  fileEntriesFromRemoteDirs,
  guessClientPlatform,
  hostInfoFromRemote,
  installPhoneVav,
  pairingPasteIsLocalHost,
  pairingPasteIsLoopback,
  pairingSecretFromPaste,
  resolvedHostPlatform
} from './phoneVav.ts'

function mockTransport(): PhoneTransport & {
  sent: Array<Record<string, unknown>>
  connected: string[]
  emit: (msg: PhoneLine) => void
} {
  const sent: Array<Record<string, unknown>> = []
  const connected: string[] = []
  const lineHandlers = new Set<(msg: PhoneLine) => void>()
  return {
    variant: 'web',
    sent,
    connected,
    send: (msg) => {
      sent.push(msg)
    },
    onLine: (handler) => {
      lineHandlers.add(handler)
      return () => lineHandlers.delete(handler)
    },
    emit(msg) {
      for (const handler of lineHandlers) handler(msg)
    },
    onStatus: () => () => undefined,
    connect: (secret) => {
      if (secret) connected.push(secret)
    },
    rediscover: () => undefined,
    pageState: () => ({ title: '', url: '', selection: '', includePage: true, includeShot: false }),
    onPage: () => () => undefined,
    setIncludePage: () => undefined,
    setIncludeShot: () => undefined
  }
}

function installWindow(): void {
  const nav = {
    language: 'en-US',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    clipboard: { writeText: async () => undefined, readText: async () => '' }
  }
  ;(globalThis as { window?: unknown }).window = {
    setTimeout,
    clearTimeout,
    navigator: nav,
    vav: undefined
  }
}

describe('phone files listing', () => {
  it('maps remote dirs (including files) the way the desktop Files tray expects', () => {
    const entries = fileEntriesFromRemoteDirs(
      [
        { name: 'README.md', path: '/tmp/README.md', isDirectory: false },
        { name: 'src', path: '/tmp/src', isDirectory: true }
      ],
      'name',
      true
    )
    assert.equal(entries[0]?.name, 'src')
    assert.equal(entries[0]?.isDirectory, true)
    assert.equal(entries[0]?.children, null)
    assert.equal(entries[1]?.name, 'README.md')
    assert.equal(entries[1]?.isDirectory, false)
    assert.equal(entries[1]?.children, undefined)
  })

  it('keeps the paired host in hosts.list so the sidebar service chip matches bootstrap', () => {
    const hosts = hostInfoFromRemote({
      type: 'host',
      name: 'Build box',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      capabilities: REMOTE_PHONE_CAPABILITIES,
      defaults: { agent: 'vav', model: '', thinking: null, approval: 'edit' },
      recentDirs: []
    })
    assert.equal(hosts[0]?.id, LOCAL_MACHINE_ID)
    assert.equal(hosts[0]?.name, 'Build box')
    assert.equal(hosts[0]?.controlPlane, true)
    assert.equal(hosts[0]?.online, true)
  })

  it('pairs a loopback vavrtp secret the same way desktop Connect pastes', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    transport.emit({
      type: 'host',
      name: 'Build box',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      capabilities: REMOTE_PHONE_CAPABILITIES,
      defaults: { agent: 'vav', model: '', thinking: null, approval: 'edit' },
      recentDirs: []
    })
    const secret = 'a'.repeat(32)
    const result = await api.hosts.pair(`vavrtp://${secret}@127.0.0.1:18746`)
    assert.equal(result.ok, true)
    assert.deepEqual(transport.connected, [secret])
    const fonts = await api.settings.availableFonts()
    assert.ok(fonts.includes('SF Mono'))
    const lan = await api.hosts.pair('vavrtp://bbbbbbbbbbbbbbbb@192.168.1.8:18746')
    assert.equal(lan.ok, true)
    assert.equal(transport.connected.at(-1), 'vavrtp://bbbbbbbbbbbbbbbb@192.168.1.8:18746')
    const wan = await api.hosts.pair('vavrtp://cccccccccccccccc@8.8.8.8:18746')
    assert.equal(wan.ok, false)
  })

  it('reads a pasted pairing secret and rejects WAN tokens', () => {
    const secret = 'c'.repeat(32)
    assert.equal(pairingSecretFromPaste(`vavrtp://${secret}@127.0.0.1:18746`), secret)
    assert.equal(pairingPasteIsLoopback(`vavrtp://${secret}@127.0.0.1:18746`), true)
    assert.equal(pairingPasteIsLoopback(`vavrtp://${secret}@192.168.1.8:18746`), false)
    assert.equal(pairingPasteIsLocalHost(`vavrtp://${secret}@192.168.1.8:18746`), true)
    assert.equal(pairingPasteIsLocalHost(`vavrtp://${secret}@8.8.8.8:18746`), false)
    assert.equal(discoverPeerFromInfo({
      proto: 1,
      app: 'vavd',
      name: 'Build box',
      version: '0.0.0',
      wsPath: '/vav',
      loopback: true,
      port: 18746
    }).address, '127.0.0.1')
  })

  it('rejects opaque tiles for the same surface-pattern rule desktop uses', () => {
    const opaque = new Uint8Array(4 * 2 * 2).fill(255)
    assert.deepEqual(assessSurfaceRgba(opaque, 2, 2), { ok: false, reason: 'no-alpha' })
    const punch = new Uint8Array(opaque)
    punch[3] = 0
    assert.deepEqual(assessSurfaceRgba(punch, 2, 2), { ok: true, size: '2px 2px' })
  })

  it('lists a planted file through browse + files:true', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    const pending = api.files.list('/tmp/workspace', 'name', true, 'c1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), {
      type: 'browse',
      conversationId: 'c1',
      path: '/tmp/workspace',
      files: true
    })
    transport.emit({
      type: 'dirs',
      conversationId: 'c1',
      path: '/tmp/workspace',
      parent: '/tmp',
      entries: [
        { name: 'src', path: '/tmp/workspace/src', isDirectory: true },
        { name: 'remote-only.md', path: '/tmp/workspace/remote-only.md', isDirectory: false }
      ]
    })
    const listing = await pending
    assert.equal(listing.error, undefined)
    assert.equal(listing.path, '/tmp/workspace')
    assert.ok(listing.entries.some((entry) => entry.name === 'remote-only.md' && !entry.isDirectory))
    assert.ok(listing.entries.some((entry) => entry.name === 'src' && entry.isDirectory))
  })

  it('returns the same host from hosts.list as bootstrap after welcome', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    transport.emit({
      type: 'host',
      name: 'Release Ext Test',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      capabilities: REMOTE_PHONE_CAPABILITIES,
      defaults: { agent: 'vav', model: '', thinking: null, approval: 'edit' },
      recentDirs: []
    })
    const hosts = await api.hosts.list()
    assert.equal(hosts[0]?.name, 'Release Ext Test')
    assert.equal(hosts[0]?.home, '/Users/ada')
  })

  it('reads the host pairing URI over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    let pairing = 'vavrtp://127.0.0.1:4752'
    const calls: string[] = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method) => {
        calls.push(method)
        if (method === 'host.rotateOffer') {
          pairing = 'vavrtp://127.0.0.1:4752?rotated=1'
          return { pairing }
        }
        if (method === 'host.pairing') return { pairing }
        if (method === 'host.incoming') {
          return { controllers: [{ id: 'g1', name: 'Web UI', state: 'online' }] }
        }
        return {}
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    assert.equal(await api.hosts.pairing(), 'vavrtp://127.0.0.1:4752')
    const status = await api.remoteControl.status()
    assert.equal(status.state, 'ready')
    assert.equal(status.pairing, 'vavrtp://127.0.0.1:4752')
    await api.hosts.rotateOffer()
    assert.equal(await api.hosts.pairing(), 'vavrtp://127.0.0.1:4752?rotated=1')
    await api.remoteControl.regenerateSecret()
    assert.ok(calls.filter((method) => method === 'host.rotateOffer').length >= 2)
    const incoming = await api.hosts.incoming()
    assert.equal(incoming[0]?.id, 'g1')
    await api.hosts.disconnectIncoming('g1')
    await api.hosts.unpairIncoming('g1')
    assert.ok(calls.includes('host.disconnectIncoming'))
    assert.ok(calls.includes('host.unpairIncoming'))
  })

  it('reads a planted file over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'fs.readdir') {
          return { entries: [{ name: 'remote-only.md', isDirectory: false, isFile: true }] }
        }
        if (method === 'fs.stat') {
          return { size: 19, mtimeMs: 1, isDirectory: false, isFile: true }
        }
        if (method === 'fs.readFile') {
          return { base64: Buffer.from('planted by vavd e2e', 'utf8').toString('base64') }
        }
        return {}
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const listing = await api.files.list('/tmp/workspace', 'name', true, 'c1')
    assert.ok(listing.entries.some((entry) => entry.name === 'remote-only.md' && !entry.isDirectory))
    const read = await api.files.read('/tmp/workspace/remote-only.md')
    assert.equal(read.error, undefined)
    assert.match(read.content, /planted by vavd e2e/)
    const inspected = await api.files.inspect('/tmp/workspace/remote-only.md')
    assert.equal(inspected.kind, 'text')
    assert.equal(inspected.name, 'remote-only.md')
    assert.match(inspected.text ?? '', /planted by vavd e2e/)
    assert.ok(calls.some((call) => call.method === 'fs.readdir'))
    assert.ok(calls.some((call) => call.method === 'fs.readFile'))
    assert.ok(calls.some((call) => call.method === 'fs.stat'))
    const written = await api.files.write('/tmp/workspace/out.md', 'from chrome')
    assert.equal(written.ok, true)
    const renamed = await api.files.rename('/tmp/workspace/out.md', 'renamed.md')
    assert.equal(renamed.ok, true)
    assert.equal(renamed.ok && renamed.path, '/tmp/workspace/renamed.md')
    const trashed = await api.files.trash(['/tmp/workspace/renamed.md'])
    assert.equal(trashed.ok, true)
    assert.ok(calls.some((call) => call.method === 'fs.writeFile'))
    assert.ok(calls.some((call) => call.method === 'fs.rename'))
    assert.ok(calls.some((call) => call.method === 'fs.unlink'))
  })

  it('reports the host OS and opens Finder / default app over the daemon plane', async () => {
    installWindow()
    assert.equal(guessClientPlatform(), 'darwin')
    assert.equal(resolvedHostPlatform('win32'), 'win32')
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        return { ok: true }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    assert.equal(api.platform, 'darwin')
    transport.emit({
      type: 'host',
      name: 'Box',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      capabilities: REMOTE_PHONE_CAPABILITIES,
      defaults: { agent: 'vav', model: '', thinking: null, approval: 'edit' },
      recentDirs: []
    })
    assert.equal(api.platform, 'darwin')
    await api.conversations.revealInFinder('/tmp/workspace/hello.md')
    const opened = await api.files.openWithDefault('/tmp/workspace/hello.md')
    assert.equal(opened.ok, true)
    const info = await api.files.getInfo('/tmp/workspace/hello.md')
    assert.equal(info.ok, true)
    const copied = await api.files.copyAsFile(['/tmp/workspace/hello.md'])
    assert.equal(copied.ok, true)
    await api.files.quickLook('/tmp/workspace/hello.md')
    assert.ok(calls.some((call) => call.method === 'fs.reveal'))
    assert.ok(calls.some((call) => call.method === 'fs.openPath'))
    assert.ok(calls.some((call) => call.method === 'fs.getInfo'))
    assert.ok(calls.some((call) => call.method === 'fs.copyAsFile'))
    assert.ok(calls.some((call) => call.method === 'fs.preview'))
  })

  it('watches the workdir over fs.watch and coalesces dirty dirs like desktop', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    const streamHandlers = new Set<(event: { stream: string; event: string; data?: unknown }) => void>()
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'fs.watch') return { stream: 'w-1' }
        return { ok: true }
      },
      onStream: (handler) => {
        streamHandlers.add(handler)
        return () => streamHandlers.delete(handler)
      }
    }
    const { api } = installPhoneVav(transport)
    const dirty: Array<{ conversationId: string; dirs: string[] }> = []
    const off = api.files.onDirty((event) => dirty.push(event))
    await api.files.watch('c1', '/tmp/workspace')
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'fs.watch' &&
          (call.params as { path?: string; recursive?: boolean } | undefined)?.path === '/tmp/workspace' &&
          (call.params as { recursive?: boolean } | undefined)?.recursive === true
      )
    )
    for (const handler of streamHandlers) {
      handler({ stream: 'w-1', event: 'watch', data: { event: 'rename', filename: 'hello.md' } })
      handler({ stream: 'w-1', event: 'watch', data: { event: 'change', filename: 'note.md' } })
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.equal(dirty.length, 1)
    assert.equal(dirty[0]?.conversationId, 'c1')
    assert.deepEqual(dirty[0]?.dirs.slice().sort(), ['/tmp/workspace'])
    await api.files.watch('c1', null)
    assert.ok(calls.some((call) => call.method === 'fs.unwatch'))
    off()
  })

  it('writes clips to the same content-addressed vav-clips path as desktop', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        return { ok: true }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    transport.emit({
      type: 'host',
      name: 'Box',
      home: '/Users/ada',
      tmp: '/tmp',
      platform: 'darwin',
      capabilities: REMOTE_PHONE_CAPABILITIES,
      defaults: { agent: 'vav', model: '', thinking: null, approval: 'edit' },
      recentDirs: []
    })
    const written = await api.files.writeClip({ filename: 'hello.png', text: 'same-bytes' })
    assert.equal(written.ok, true)
    if (!written.ok) return
    assert.match(written.path, /\/tmp\/vav-clips\/[0-9a-f]{16}\/hello\.png/)
    assert.equal(written.displayName, 'hello.png')
    assert.ok(calls.some((call) => call.method === 'fs.mkdir'))
    assert.ok(calls.some((call) => call.method === 'fs.writeFile'))
  })

  it('reads git status over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'git.status') {
          return {
            cwd: '/tmp/ws',
            isRepo: true,
            toplevel: '/tmp/ws',
            projectName: 'ws',
            branch: 'main',
            detached: false,
            headShort: 'abc123',
            worktreeLabel: 'Local',
            isAdditionalWorktree: false,
            worktrees: [],
            branches: ['main'],
            changes: [
              {
                path: 'hello.md',
                absolutePath: '/tmp/ws/hello.md',
                status: 'modified',
                code: ' M',
                staged: false,
                unstaged: true
              }
            ]
          }
        }
        return { ok: false, error: 'unused' }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const snap = await api.git.status('/tmp/ws')
    assert.equal(snap.isRepo, true)
    assert.equal(snap.changes[0]?.path, 'hello.md')
    assert.ok(calls.some((call) => call.method === 'git.status'))
  })

  it('lists plugins over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'plugins.list') {
          return { host: 'vav', root: '/tmp/plugins', plugins: [{ id: 'vav:bundled', name: 'Bundled' }] }
        }
        return { ok: false, error: 'unused' }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const snap = await api.plugins.list('vav')
    assert.equal(snap.host, 'vav')
    assert.ok(Array.isArray(snap.plugins))
    assert.ok(calls.some((call) => call.method === 'plugins.list'))
  })

  it('unwraps plugin mutations to a snapshot the way desktop IPC does', async () => {
    installWindow()
    const transport = mockTransport()
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method) => {
        if (method === 'plugins.setEnabled') {
          return {
            ok: true,
            snapshot: { host: 'vav', root: '/tmp/plugins', plugins: [{ id: 'p1', enabled: false }] }
          }
        }
        return { ok: false, error: 'unused' }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const snap = await api.plugins.setEnabled('vav', 'p1', false)
    assert.equal('host' in snap && snap.host, 'vav')
    assert.ok(!('ok' in snap && snap.ok === true))
  })

  it('lists GitHub pulls, timers, and connectors over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'github.listPulls') {
          return { ok: true, data: { pulls: [{ number: 1, title: 'fix' }] } }
        }
        if (method === 'timers.listJobs') return [{ id: 'job-1', title: 'nightly' }]
        if (method === 'connectors.catalog') return [{ id: 'github' }]
        if (method === 'connectors.beginLogin') {
          return { rows: [], login: { connector: 'github', status: 'running' } }
        }
        return { ok: false, error: 'unused' }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const pulls = await api.github.listPulls('/tmp/ws', 'open')
    const jobs = await api.timers.listJobs()
    const connectors = await api.connectors.catalog()
    const login = await api.connectors.beginLogin('github')
    assert.equal(pulls.ok, true)
    assert.equal(jobs[0]?.id, 'job-1')
    assert.equal(connectors[0]?.id, 'github')
    assert.equal(login.login.status, 'running')
    assert.ok(calls.some((call) => call.method === 'github.listPulls'))
    assert.ok(calls.some((call) => call.method === 'timers.listJobs'))
    assert.ok(calls.some((call) => call.method === 'connectors.catalog'))
    assert.ok(calls.some((call) => call.method === 'connectors.beginLogin'))
  })

  it('opens a file session over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'fileSessions.open') {
          return {
            fileId: 'f1',
            activeSessionId: 's1',
            sessions: [{ id: 's1', title: 'New session', createdAt: 1, updatedAt: 1 }]
          }
        }
        return null
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const opened = await api.fileSessions.open('/tmp/note.md')
    assert.equal(opened?.fileId, 'f1')
    assert.equal(opened?.activeSessionId, 's1')
    assert.ok(calls.some((call) => call.method === 'fileSessions.open'))
  })

  it('sends compact / regenerate on the phone plane', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    const pending = api.agent.compact('c1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), { type: 'compact', conversationId: 'c1' })
    transport.emit({
      type: 'compacted',
      conversationId: 'c1',
      ok: true,
      compaction: {
        leafId: 'leaf',
        keepAfterMessageId: 'm2',
        summary: 'folded',
        createdAt: 1,
        compactedCount: 4,
        estimatedContextTokens: 20
      }
    })
    const compacted = await pending
    assert.equal(compacted.ok, true)
    if (compacted.ok) assert.equal(compacted.compaction.compactedCount, 4)
    await api.agent.regenerate('c1', 'a1')
    assert.deepEqual(transport.sent.at(-1), { type: 'regenerate', conversationId: 'c1', messageId: 'a1' })
    const removed = await api.conversations.remove(['c1'])
    assert.deepEqual(removed.removed, ['c1'])
    assert.deepEqual(transport.sent.at(-1), { type: 'archive', conversationId: 'c1' })
  })

  it('sends edit / fork / delete-message / leaf on the phone plane', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    await api.agent.editUserMessage('c1', 'u1', 'rewritten')
    assert.deepEqual(transport.sent.at(-1), {
      type: 'edit',
      conversationId: 'c1',
      messageId: 'u1',
      text: 'rewritten'
    })
    const forked = api.agent.fork('c1', 'a1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), { type: 'fork', conversationId: 'c1', messageId: 'a1' })
    transport.emit({
      type: 'thread',
      conversationId: 'c1',
      messages: [{ id: 'u1', role: 'user', text: 'note', at: 1 }]
    })
    assert.equal(await forked, 'u1')
    const deleted = api.conversations.deleteMessage('c1', 'a1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), {
      type: 'delete-message',
      conversationId: 'c1',
      messageId: 'a1'
    })
    transport.emit({
      type: 'thread',
      conversationId: 'c1',
      messages: [{ id: 'u1', role: 'user', text: 'note', at: 1 }]
    })
    const gone = await deleted
    assert.equal(gone?.activeLeafId, 'u1')
    const branched = api.conversations.selectBranch('c1', 'u1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), {
      type: 'leaf',
      conversationId: 'c1',
      messageId: 'u1',
      follow: true
    })
    transport.emit({
      type: 'thread',
      conversationId: 'c1',
      messages: [{ id: 'u1', role: 'user', text: 'note', at: 1 }]
    })
    assert.equal(await branched, 'u1')
    const duplicated = api.conversations.duplicate('c1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), { type: 'duplicate', conversationId: 'c1' })
    transport.emit({
      type: 'created',
      session: {
        id: 'c2',
        title: 'Copy',
        dirLabel: '',
        status: 'idle',
        surface: 'vav',
        updatedAt: 1
      }
    })
    assert.equal((await duplicated)?.id, 'c2')
  })

  it('sends goal and locate on the phone plane', async () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    const goal = api.conversations.setAcpGoal('c1', 'set', 'ship it')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), {
      type: 'goal',
      conversationId: 'c1',
      action: 'set',
      objective: 'ship it'
    })
    transport.emit({
      type: 'goaled',
      conversationId: 'c1',
      ok: true,
      via: 'slash',
      text: '/goal ship it'
    })
    const goaled = await goal
    assert.equal(goaled.ok, true)
    if (goaled.ok) assert.equal(goaled.via, 'slash')
    const located = api.conversations.locateWorkspace('c1', '/tmp/kept')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(transport.sent.at(-1), {
      type: 'locate',
      conversationId: 'c1',
      destinationDir: '/tmp/kept'
    })
    transport.emit({ type: 'located', conversationId: 'c1', ok: true, workdir: '/tmp/kept/Workspace' })
    const row = await located
    assert.equal(row.ok, true)
  })

  it('lists host directories over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        if (method === 'fs.readdir') {
          return {
            entries: [
              { name: 'src', isDirectory: true },
              { name: 'README.md', isDirectory: false }
            ]
          }
        }
        return { path: (params as { path?: string })?.path }
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const listing = await api.hosts.listDir('local', '/tmp/ws')
    assert.ok(listing.entries.some((entry) => entry.name === 'src' && entry.isDirectory))
    assert.ok(listing.entries.some((entry) => entry.name === 'README.md' && !entry.isDirectory))
  })

  it('opens settings through the phone overlay event', async () => {
    installWindow()
    const events: string[] = []
    const win = (globalThis as { window: Record<string, unknown> }).window
    win.addEventListener = () => undefined
    win.removeEventListener = () => undefined
    win.dispatchEvent = (event: { type?: string }) => {
      if (event?.type) events.push(event.type)
      return true
    }
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    await api.window.openSettings('agents', 'vav')
    assert.ok(events.includes('vav:phone-open-settings'))
    await api.window.openFilePreview('/tmp/ws/note.md')
    assert.ok(events.includes('vav:phone-open-file-preview'))
    await api.window.setPreviewCloseGuard(true)
    await api.window.forcePreviewClose()
    assert.equal(typeof api.window.onPreviewCloseAttempt(() => undefined), 'function')
    const desired = await api.window.desiredSettingsView()
    assert.equal(desired.view, 'agents')
    assert.equal(desired.agentId, 'vav')
  })

  it('queries host logs and binary files over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'logs.query') return { records: [{ id: 'l1', event: 'send' }] }
        if (method === 'logs.stats') return { ephemeral: 1, session: 0, durable: 0, total: 1 }
        if (method === 'fs.readFile') {
          return { base64: Buffer.from('png', 'utf8').toString('base64') }
        }
        return {}
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const rows = await api.logs.query()
    const stats = await api.logs.stats()
    const binary = await api.files.readBinary('/tmp/shot.png')
    assert.equal(rows[0]?.id, 'l1')
    assert.equal(stats.total, 1)
    assert.equal(binary.ok, true)
    if (binary.ok) assert.equal(binary.mime, 'image/png')
    assert.ok(calls.some((call) => call.method === 'logs.query'))
    assert.ok(calls.some((call) => call.method === 'fs.readFile'))
  })

  it('lists and creates provider accounts over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'accounts.getPage') {
          return {
            workspaceKey: 'ws',
            workspaceLabel: 'ws',
            groups: [],
            accounts: [{ id: 'a1', name: 'VAV', kind: 'vav_key', current: true }],
            usage: []
          }
        }
        if (method === 'accounts.createVav') {
          return {
            workspaceKey: 'ws',
            workspaceLabel: 'ws',
            groups: [],
            accounts: [{ id: 'a2', name: (params as { name?: string }).name, kind: 'vav_key' }],
            usage: []
          }
        }
        if (method === 'accounts.beginOAuth') {
          return {
            workspaceKey: 'ws',
            workspaceLabel: 'ws',
            groups: [],
            accounts: [{ id: 'a3', name: 'grok', kind: 'oauth' }],
            usage: [],
            oauthLogin: { agentId: (params as { agentId?: string }).agentId, status: 'running' }
          }
        }
        return {}
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const page = await api.accounts.getPage()
    assert.equal(page.accounts[0]?.id, 'a1')
    const created = await api.accounts.createVav({
      name: 'Work',
      endpoint: 'https://api.example.com',
      apiKey: 'sk-test'
    })
    assert.equal(created.accounts[0]?.id, 'a2')
    assert.ok(calls.some((call) => call.method === 'accounts.getPage'))
    assert.ok(calls.some((call) => call.method === 'accounts.createVav'))
    const oauth = await api.accounts.beginOAuth('grok')
    assert.equal(oauth.oauthLogin?.status, 'running')
    assert.ok(calls.some((call) => call.method === 'accounts.beginOAuth'))
  })

  it('reads and writes host settings over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    const calls: Array<{ method: string; params?: unknown }> = []
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        calls.push({ method, params })
        if (method === 'settings.get') return { defaultModel: 'hosted-model', apiKeyPresent: false }
        if (method === 'settings.update') return { defaultModel: (params as { defaultModel?: string }).defaultModel }
        if (method === 'settings.setSecret') {
          return { hint: 'sk-…', apiKeyPresent: true }
        }
        return {}
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const page = await api.settings.get()
    assert.equal(page.defaultModel, 'hosted-model')
    const next = await api.settings.update({ defaultModel: 'next-model', theme: 'dark' })
    assert.equal(next.defaultModel, 'next-model')
    assert.equal(next.theme, 'dark')
    assert.ok(calls.some((call) => call.method === 'settings.get'))
    assert.ok(calls.some((call) => call.method === 'settings.update'))
    const keyed = await api.settings.setApiKey('sk-test')
    assert.equal(keyed.hint, 'sk-…')
    assert.ok(calls.some((call) => call.method === 'settings.setSecret'))
  })

  it('reads a change set over the daemon plane', async () => {
    installWindow()
    const transport = mockTransport()
    transport.daemon = {
      ready: async () => true,
      hello: async () => true,
      request: async (method, params) => {
        if (method === 'changeSets.get') return { id: (params as { id?: string }).id, files: [] }
        return null
      },
      onStream: () => () => undefined
    }
    const { api } = installPhoneVav(transport)
    const row = await api.changeSets.get('cs-1')
    assert.equal(row?.id, 'cs-1')
  })

  it('projects host recovery chrome onto the same turn events desktop StreamStatus reads', () => {
    installWindow()
    const transport = mockTransport()
    const { api } = installPhoneVav(transport)
    const events: Array<{ type?: string; phase?: string; recovery?: { kind?: string } }> = []
    api.agent.onEvent((event) => events.push(event))
    transport.emit({
      type: 'turn',
      conversationId: 's1',
      phase: 'running',
      draft: 'partial e2e reply',
      recovery: { kind: 'healing', attempt: 1, limit: 3 }
    })
    const phase = events.find((event) => event.type === 'phase')
    assert.equal(phase?.phase, 'healing')
    assert.equal(phase?.recovery?.kind, 'healing')
  })
})
