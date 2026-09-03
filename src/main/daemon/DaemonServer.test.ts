import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer, type DaemonWorkspaceCatalog } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost, requestLanPairOffer } from './DaemonClient.ts'
import { createConnection } from 'node:net'
import { encodeLine, parseServerMessage } from '../../shared/remoteControl.ts'
import { RemoteControlHub } from '../remote/RemoteControlHub.ts'
import { REMOTE_PHONE_CAPABILITIES } from '../../shared/remoteControl.ts'

const SECRET = '0123456789abcdef01234567'

async function startPair(
  dir: string,
  catalog?: DaemonWorkspaceCatalog
): Promise<{
  server: DaemonServer
  client: DaemonClient
  remote: ReturnType<typeof createRemoteWorkspaceHost>
}> {
  const host = createLocalWorkspaceHost({ name: 'loop' })
  const server = new DaemonServer({
    host,
    identity: { machineId: 'loop-box', name: 'loop' },
    secret: () => SECRET,
    appVersion: 'test',
    home: dir,
    tmp: dir,
    catalog
  })
  const client = new DaemonClient()
  const port = await server.listen(0, '127.0.0.1')
  const welcome = await client.connect({
    host: '127.0.0.1',
    port,
    secret: SECRET,
    device: 'test'
  })
  return { server, client, remote: createRemoteWorkspaceHost(client, welcome) }
}

describe('daemon loopback', () => {
  it('pairs, reads and writes files, and runs a process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const file = join(dir, 'note.txt')
      await remote.fs.writeFile(file, 'hello-daemon', 'utf8')
      assert.equal((await remote.fs.readFile(file)).toString('utf8'), 'hello-daemon')
      assert.equal(await remote.fs.exists(file), true)
      const names = (await remote.fs.readdir(dir)).map((d) => d.name)
      assert.ok(names.includes('note.txt'))
      const info = await remote.fs.stat(file)
      assert.equal(info.isFile(), true)
      assert.ok(info.size > 0)

      const child = remote.process.spawn(process.execPath, ['-e', 'process.stdout.write("ok")'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        child.on('error', reject)
        child.on('close', () => resolve())
      })
      assert.equal(Buffer.concat(chunks).toString('utf8'), 'ok')
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('mkdirs, renames, and reads through an open handle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const nested = join(dir, 'sub')
      await remote.fs.mkdir(nested, { recursive: true })
      const from = join(nested, 'a.txt')
      const to = join(nested, 'b.txt')
      await remote.fs.writeFile(from, 'handle-bytes')
      await remote.fs.rename(from, to)
      assert.equal(await remote.fs.exists(from), false)
      const fh = await remote.fs.open(to, 'r')
      const buf = Buffer.alloc(6)
      const { bytesRead } = await fh.read(buf, 0, 6, 0)
      await fh.close()
      assert.equal(bytesRead, 6)
      assert.equal(buf.toString('utf8'), 'handle')
      await remote.fs.unlink(to)
      assert.equal(await remote.fs.exists(to), false)
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('echoes stdin to a spawned process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const child = remote.process.spawn(
        process.execPath,
        [
          '-e',
          'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>process.stdout.write(s.toUpperCase()))'
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const chunks: Buffer[] = []
      const done = new Promise<void>((resolve, reject) => {
        child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        child.on('error', reject)
        child.on('close', () => resolve())
      })
      child.stdin?.write('ab')
      child.stdin?.end()
      await done
      assert.equal(Buffer.concat(chunks).toString('utf8'), 'AB')
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('streams a remote PTY', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const proc = remote.pty.spawn(process.execPath, ['-e', 'process.stdout.write("pty-ok")'], {
        cols: 80,
        rows: 24,
        cwd: dir
      })
      let data = ''
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finished = new Promise<number>((resolve) => {
        proc.onData((chunk) => {
          data += chunk
        })
        proc.onExit((e) => resolve(e.exitCode))
      })
      const code = await Promise.race([
        finished,
        new Promise<number>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`pty timeout, data=${JSON.stringify(data)}`)),
            5000
          )
          timeout.unref?.()
        })
      ]).finally(() => {
        if (timeout) clearTimeout(timeout)
      })
      assert.equal(code, 0)
      assert.match(data, /pty-ok/)
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('notifies fs.watch when a file appears', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const seen: string[] = []
      const watcher = remote.fs.watch(dir, {}, (_event, filename) => {
        if (filename) seen.push(filename.toString())
      })
      await writeFile(join(dir, 'appeared.txt'), 'x')
      const start = Date.now()
      while (!seen.some((name) => name.includes('appeared')) && Date.now() - start < 2500) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      watcher.close()
      assert.ok(
        seen.some((name) => name.includes('appeared')),
        `watch events: ${seen.join(',')}`
      )
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a file above the daemon read cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client, remote } = await startPair(dir)
    try {
      const file = join(dir, 'big.bin')
      await writeFile(file, Buffer.alloc(6 * 1024 * 1024 + 64, 1))
      await assert.rejects(() => remote.fs.readFile(file), /6MB/)
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a bad secret', async () => {
    const host = createLocalWorkspaceHost({ name: 'loop' })
    const server = new DaemonServer({
      host,
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: tmpdir(),
      tmp: tmpdir()
    })
    const client = new DaemonClient()
    try {
      const port = await server.listen(0, '127.0.0.1')
      await assert.rejects(
        () => client.connect({ host: '127.0.0.1', port, secret: 'wrong-secret-value!!' }),
        /pairing rejected|closed/
      )
    } finally {
      client.close()
      server.close()
    }
  })

  it('offers a pairing line after LAN pair-ask is approved', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const pairing = `vav-daemon:{"v":1,"secret":"${SECRET}","machineId":"loop-box","name":"loop"}`
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      pairing: () => pairing,
      onPairAsk: async () => true
    })
    try {
      const port = await server.listen(0, '127.0.0.1')
      const offered = await requestLanPairOffer({
        host: '127.0.0.1',
        port,
        name: 'Studio',
        machineId: 'studio-1'
      })
      assert.equal(offered, pairing)
    } finally {
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('declines a LAN pair-ask', async () => {
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: tmpdir(),
      tmp: tmpdir(),
      pairing: () => 'vav-daemon:{}',
      onPairAsk: async () => false
    })
    try {
      const port = await server.listen(0, '127.0.0.1')
      await assert.rejects(
        () =>
          requestLanPairOffer({
            host: '127.0.0.1',
            port,
            name: 'Studio',
            machineId: 'studio-1'
          }),
        /pairing declined/
      )
    } finally {
      server.close()
    }
  })

  it('cancels a LAN pair-ask when aborted', async () => {
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: tmpdir(),
      tmp: tmpdir(),
      pairing: () => 'vav-daemon://x',
      onPairAsk: () => new Promise(() => undefined)
    })
    try {
      const port = await server.listen(0, '127.0.0.1')
      const abort = new AbortController()
      const pending = requestLanPairOffer({
        host: '127.0.0.1',
        port,
        name: 'Studio',
        machineId: 'studio-1',
        signal: abort.signal
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(server.incoming().some((row) => row.state === 'pending' && row.name === 'Studio'), true)
      abort.abort()
      await assert.rejects(() => pending, /pairing cancelled/)
    } finally {
      server.close()
    }
  })

  it('resolves executables via proc.which', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      assert.equal(await client.which([process.execPath]), process.execPath)
      assert.equal(await client.which(['vav-daemon-which-missing-xyz']), null)
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves sessions and folder recents from the host catalog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const session = {
      id: 'host-s1',
      title: 'From host',
      workingDirectory: join(dir, 'proj'),
      machineId: 'local',
      messages: [{ id: 'm1', role: 'user', content: 'hi', parentId: null }]
    }
    const { server, client } = await startPair(dir, {
      listSessions: () => [{ id: session.id, title: session.title }],
      getSession: (id) => (id === session.id ? session : null),
      listRecents: () => [join(dir, 'proj'), join(dir, 'other')]
    })
    try {
      const listed = (await client.request('sessions.list')) as {
        sessions: Array<{ id: string; title: string }>
      }
      assert.equal(listed.sessions[0]?.id, 'host-s1')
      const got = (await client.request('sessions.get', { id: 'host-s1' })) as {
        conversation: { title: string; messages: unknown[] }
      }
      assert.equal(got.conversation.title, 'From host')
      assert.equal(got.conversation.messages.length, 1)
      const missing = (await client.request('sessions.get', { id: 'nope' })) as {
        conversation: unknown
      }
      assert.equal(missing.conversation, null)
      const recents = (await client.request('workspace.recents')) as { paths: string[] }
      assert.deepEqual(recents.paths, [join(dir, 'proj'), join(dir, 'other')])
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns empty catalog lists when the host has none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      const listed = (await client.request('sessions.list')) as { sessions: unknown[] }
      assert.deepEqual(listed.sessions, [])
      const recents = (await client.request('workspace.recents')) as { paths: unknown[] }
      assert.deepEqual(recents.paths, [])
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('binds loopback when listen() is called without a hostname', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir
    })
    const client = new DaemonClient()
    try {
      const port = await server.listen(0)
      const welcome = await client.connect({
        host: '127.0.0.1',
        port,
        secret: SECRET,
        device: 'test'
      })
      assert.equal(welcome.host.id, 'loop-box')
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hands a phone-role hello to the control hub and keeps daemon RPC separate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const sent: string[] = []
    const hub = new RemoteControlHub({
      appVersion: 'test',
      secret: () => SECRET,
      listSessions: () => [
        {
          id: 'c1',
          title: 'Host chat',
          dirLabel: '',
          status: 'idle',
          surface: 'vav',
          updatedAt: 1
        }
      ],
      listThread: () => null,
      listControls: () => null,
      listHost: () => ({
        type: 'host',
        name: 'loop',
        home: dir,
        tmp: dir,
        capabilities: REMOTE_PHONE_CAPABILITIES,
        defaults: { agent: 'vav', model: '', thinking: null, approval: 'auto' },
        recentDirs: []
      }),
      configure: () => 'ok',
      sendMessage: (_id, text) => {
        sent.push(text)
        return 'ok'
      },
      createSession: () => {
        throw new Error('unused')
      },
      cancel: () => 'ok',
      reply: () => false,
      rename: () => 'ok',
      archive: () => 'ok',
      pin: () => 'ok',
      favorite: () => 'ok',
      browse: () => 'not-found',
      setWorkspace: () => 'ok'
    })
    const host = createLocalWorkspaceHost({ name: 'loop' })
    const server = new DaemonServer({
      host,
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir,
      onControlHello: (socket, leftover, hello) => hub.adoptAuthed(socket, leftover, hello)
    })
    const port = await server.listen(0, '127.0.0.1')
    try {
      const daemon = new DaemonClient()
      await daemon.connect({ host: '127.0.0.1', port, secret: SECRET, device: 'fs' })
      const listed = (await daemon.request('sessions.list')) as { sessions: unknown[] }
      assert.deepEqual(listed.sessions, [])

      const phone = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        phone.once('connect', resolve)
        phone.once('error', reject)
      })
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, device: 'iPhone', role: 'phone' }))
      const welcomed = await new Promise<boolean>((resolve, reject) => {
        let buf = ''
        phone.setEncoding('utf8')
        phone.on('data', (chunk: string) => {
          buf += chunk
          for (const line of buf.split('\n').slice(0, -1)) {
            const parsed = parseServerMessage(JSON.parse(line) as unknown)
            if (parsed?.type === 'welcome') resolve(true)
          }
        })
        phone.on('error', reject)
        setTimeout(() => reject(new Error('no welcome')), 2000)
      })
      assert.equal(welcomed, true)
      phone.write(encodeLine({ type: 'send', conversationId: 'c1', text: 'from phone' }))
      await new Promise((resolve) => setTimeout(resolve, 80))
      assert.deepEqual(sent, ['from phone'])
      phone.destroy()
      daemon.close()
    } finally {
      hub.dispose()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a phone hello when the host is headless', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      const port = server.port()
      const phone = createConnection({ host: '127.0.0.1', port })
      await new Promise<void>((resolve, reject) => {
        phone.once('connect', resolve)
        phone.once('error', reject)
      })
      phone.write(encodeLine({ type: 'hello', proto: 1, auth: SECRET, device: 'iPhone', role: 'phone' }))
      const code = await new Promise<string>((resolve, reject) => {
        let buf = ''
        phone.setEncoding('utf8')
        phone.on('data', (chunk: string) => {
          buf += chunk
          if (!buf.includes('\n')) return
          const parsed = parseServerMessage(JSON.parse(buf.trim()) as unknown)
          if (parsed?.type === 'error') resolve(parsed.code)
        })
        phone.on('error', reject)
        setTimeout(() => reject(new Error('no error')), 2000)
      })
      assert.equal(code, 'bad-request')
      phone.destroy()
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('mints a grant, lists the controller, and unpairs it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      assert.ok(client.welcome?.grant?.id)
      assert.equal(server.incoming().length, 1)
      assert.equal(server.incoming()[0]?.online, true)
      const grantId = client.welcome!.grant!.id
      const grantSecret = client.welcome!.grant!.secret

      assert.equal(server.unpairGrant(grantId), true)
      assert.equal(server.incoming().filter((row) => row.state !== 'revoked').length, 0)
      assert.equal(server.incoming().some((row) => row.state === 'revoked'), true)

      const again = new DaemonClient()
      const port = server.port()
      await assert.rejects(
        () => again.connect({ host: '127.0.0.1', port, secret: grantSecret, device: 'test' }),
        /pairing rejected|revoked|closed/
      )
      again.close()

      const fresh = new DaemonClient()
      const welcome = await fresh.connect({
        host: '127.0.0.1',
        port,
        secret: SECRET,
        device: 'test',
        clientId: 'other'
      })
      assert.ok(welcome.grant?.id)
      assert.notEqual(welcome.grant?.id, grantId)
      const rows = server.incoming()
      assert.equal(rows.filter((row) => row.state === 'online').length, 1)
      assert.equal(rows.find((row) => row.state === 'online')?.id, welcome.grant?.id)
      assert.equal(rows.some((row) => row.state === 'revoked' && row.id === grantId), true)
      fresh.close()
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('unpairs one computer without rotating the other grant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    const other = new DaemonClient()
    try {
      const keep = await other.connect({
        host: '127.0.0.1',
        port: server.port(),
        secret: SECRET,
        device: 'other',
        clientId: 'other-box'
      })
      assert.ok(keep.grant?.id)
      const dropId = client.welcome!.grant!.id
      assert.notEqual(keep.grant.id, dropId)
      assert.equal(server.incoming().filter((row) => row.state === 'online').length, 2)

      assert.equal(server.unpairGrant(dropId), true)
      assert.equal(other.connected, true)
      assert.equal(server.incoming().some((row) => row.id === keep.grant?.id && row.state === 'online'), true)

      const denied = new DaemonClient()
      await assert.rejects(
        () =>
          denied.connect({
            host: '127.0.0.1',
            port: server.port(),
            secret: client.welcome!.grant!.secret,
            device: 'test'
          }),
        /pairing rejected|revoked|closed/
      )
      denied.close()

      const again = new DaemonClient()
      const welcome = await again.connect({
        host: '127.0.0.1',
        port: server.port(),
        secret: keep.grant.secret,
        device: 'other',
        grantId: keep.grant.id
      })
      assert.equal(welcome.grant?.id, keep.grant.id)
      again.close()
    } finally {
      other.close()
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps issued grants after the printed offer rotates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    let offer = SECRET
    const host = createLocalWorkspaceHost({ name: 'loop' })
    const server = new DaemonServer({
      host,
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => offer,
      appVersion: 'test',
      home: dir,
      tmp: dir
    })
    const client = new DaemonClient()
    try {
      const port = await server.listen(0, '127.0.0.1')
      const welcome = await client.connect({
        host: '127.0.0.1',
        port,
        secret: SECRET,
        device: 'test',
        clientId: 'kept'
      })
      assert.ok(welcome.grant)
      offer = 'rotated-offer-secret-24b'
      const stale = new DaemonClient()
      await assert.rejects(
        () =>
          stale.connect({
            host: '127.0.0.1',
            port,
            secret: SECRET,
            device: 'new',
            clientId: 'fresh'
          }),
        /pairing rejected|revoked|closed/
      )
      stale.close()
      const again = new DaemonClient()
      const refreshed = await again.connect({
        host: '127.0.0.1',
        port,
        secret: welcome.grant.secret,
        device: 'test',
        grantId: welcome.grant.id
      })
      assert.equal(refreshed.grant?.id, welcome.grant.id)
      again.close()
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('disconnects a live grant without revoking it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      const grant = client.welcome?.grant
      assert.ok(grant)
      assert.equal(server.disconnectGrant(grant.id), true)
      const start = Date.now()
      while (client.connected && Date.now() - start < 1000) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(client.connected, false)
      assert.equal(server.incoming()[0]?.state, 'kicked')
      assert.equal(server.incoming()[0]?.online, false)

      const again = new DaemonClient()
      const welcome = await again.connect({
        host: '127.0.0.1',
        port: server.port(),
        secret: grant.secret,
        device: 'test',
        grantId: grant.id
      })
      assert.equal(welcome.grant?.id, grant.id)
      again.close()
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('revokes the grant when the client asks to leave', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-daemon-'))
    const { server, client } = await startPair(dir)
    try {
      const grantId = client.welcome?.grant?.id
      assert.ok(grantId)
      await client.request('pair.leave')
      const start = Date.now()
      while (
        server.incoming().some((row) => row.state !== 'revoked') &&
        Date.now() - start < 1000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(server.incoming().some((row) => row.state === 'revoked'), true)
      assert.equal(server.incoming().some((row) => row.state !== 'revoked'), false)
    } finally {
      client.close()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
