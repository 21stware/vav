import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost } from './DaemonClient.ts'

const SECRET = '0123456789abcdef01234567'

async function startPair(dir: string): Promise<{
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
    tmp: dir
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
})
