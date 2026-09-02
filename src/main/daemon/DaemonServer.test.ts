import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer, type DaemonWorkspaceCatalog } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost, requestLanPairOffer } from './DaemonClient.ts'

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
      const proc = remote.pty.spawn('sh', ['-c', 'printf pty-ok'], {
        cols: 80,
        rows: 24,
        cwd: dir
      })
      let data = ''
      const finished = new Promise<number>((resolve) => {
        proc.onData((chunk) => {
          data += chunk
        })
        proc.onExit((e) => resolve(e.exitCode))
      })
      const code = await Promise.race([
        finished,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error(`pty timeout, data=${JSON.stringify(data)}`)), 5000)
        )
      ])
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
})
