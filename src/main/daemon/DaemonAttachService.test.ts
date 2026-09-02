import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { encodeDaemonPairing, DAEMON_PROTO_VERSION, parseMachinePairing } from '../../shared/daemonProtocol.ts'
import { encodePairing } from '../../shared/remoteControl.ts'
import { HostRegistry, createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer } from './DaemonServer.ts'
import { DaemonAttachService } from './DaemonAttachService.ts'

const SECRET = '0123456789abcdef01234567'

async function listenLoopback(dir: string): Promise<{ server: DaemonServer; port: number }> {
  const server = new DaemonServer({
    host: createLocalWorkspaceHost({ name: 'box' }),
    identity: { machineId: 'box-1', name: 'box' },
    secret: () => SECRET,
    appVersion: 'test',
    home: dir,
    tmp: dir
  })
  const port = await server.listen(0, '127.0.0.1')
  return { server, port }
}

function attach(
  userData: string,
  enabled = false,
  extra?: { dialTunnel?: (token: string) => Promise<{ host: string; port: number; close: () => void }> }
): {
  service: DaemonAttachService
  registry: HostRegistry
} {
  const registry = new HostRegistry()
  return {
    registry,
    service: new DaemonAttachService({
      userData,
      registry,
      identityName: 'client',
      secret: () => SECRET,
      appVersion: 'test',
      enabled: () => enabled,
      tailcatToken: () => null,
      dialTunnel: extra?.dialTunnel,
      onHostsChanged: () => undefined
    })
  }
}

describe('DaemonAttachService', () => {
  it('pairs, persists, and can forget a remote host', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service, registry } = attach(userData)
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
      if (!result.ok) return
      assert.equal(result.host.id, 'box-1')
      assert.equal(result.host.online, true)
      assert.equal(registry.get('box-1')?.info.online, true)
      const stored = JSON.parse(await readFile(join(userData, 'paired-hosts.json'), 'utf8')) as {
        hosts: { machineId: string }[]
      }
      assert.equal(stored.hosts[0]?.machineId, 'box-1')

      service.forget('box-1')
      assert.equal(registry.get('box-1'), undefined)
      const after = JSON.parse(await readFile(join(userData, 'paired-hosts.json'), 'utf8')) as {
        hosts: unknown[]
      }
      assert.equal(after.hosts.length, 0)
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('pulls the host catalog after pairing', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const proj = join(disk, 'proj')
    const server = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'box' }),
      identity: { machineId: 'box-1', name: 'box' },
      secret: () => SECRET,
      appVersion: 'test',
      home: disk,
      tmp: disk,
      catalog: {
        listSessions: () => [{ id: 's1', title: 'Host chat' }],
        getSession: (id) =>
          id === 's1'
            ? { id: 's1', title: 'Host chat', workingDirectory: proj, messages: [] }
            : null,
        listRecents: () => [proj]
      }
    })
    const port = await server.listen(0, '127.0.0.1')
    const { service } = attach(userData)
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
      const catalog = await service.pullHostCatalog('box-1')
      assert.equal((catalog.sessions[0] as { title: string }).title, 'Host chat')
      assert.deepEqual(catalog.recents, [proj])
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('restores an unreachable host as offline and does not touch local disk', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const localProbe = join(userData, 'should-not-read.txt')
    await writeFile(localProbe, 'local-only')
    await writeFile(
      join(userData, 'paired-hosts.json'),
      JSON.stringify({
        hosts: [
          {
            machineId: 'gone',
            name: 'Gone Box',
            secret: SECRET,
            host: '127.0.0.1',
            port: 1
          }
        ]
      })
    )
    const { service, registry } = attach(userData)
    try {
      service.restore()
      const start = Date.now()
      while (!registry.get('gone') && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      const host = registry.get('gone')
      assert.ok(host)
      assert.equal(host.info.online, false)
      await assert.rejects(async () => host.fs.readFile(localProbe), /offline/)
    } finally {
      service.dispose()
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('reconnects a stored host when the daemon is back', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    await writeFile(
      join(userData, 'paired-hosts.json'),
      JSON.stringify({
        hosts: [
          {
            machineId: 'box-1',
            name: 'box',
            secret: SECRET,
            host: '127.0.0.1',
            port
          }
        ]
      })
    )
    const { service, registry } = attach(userData)
    try {
      service.restore()
      const start = Date.now()
      let online = false
      while (Date.now() - start < 2000) {
        const host = registry.get('box-1')
        if (host?.info.online) {
          online = true
          await host.fs.writeFile(join(disk, 'restored.txt'), 'yes')
          assert.equal((await host.fs.readFile(join(disk, 'restored.txt'))).toString('utf8'), 'yes')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      assert.equal(online, true)
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('rejects garbage and a wrong secret without mounting a host', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service, registry } = attach(userData)
    try {
      const garbage = await service.pair('not-a-pairing')
      assert.equal(garbage.ok, false)
      if (!garbage.ok) assert.match(garbage.error, /unrecognized/)

      const bad = await service.pair(`127.0.0.1:${port} ${'x'.repeat(20)}`)
      assert.equal(bad.ok, false)
      assert.equal(registry.list().some((h) => h.kind === 'remote'), false)
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('pairs from a host:port secret line', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service, registry } = attach(userData)
    try {
      const result = await service.pair(`127.0.0.1:${port} ${SECRET}`)
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.host.id, 'box-1')
      assert.equal(registry.get('box-1')?.info.online, true)
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('pairs over a tunnel token without contacting the LAN address', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    let dialed = ''
    const { service } = attach(userData, false, {
      dialTunnel: async (token) => {
        dialed = token
        return { host: '127.0.0.1', port, close: () => undefined }
      }
    })
    try {
      const result = await service.pair(
        encodeDaemonPairing({
          v: DAEMON_PROTO_VERSION,
          secret: SECRET,
          machineId: 'ignored',
          name: 'box',
          host: '192.0.2.1',
          port: 1,
          token: 'tcTESTTOKEN'
        })
      )
      assert.equal(result.ok, true)
      assert.equal(dialed, 'tcTESTTOKEN')
      if (result.ok) assert.equal(result.host.id, 'box-1')
      const stored = JSON.parse(await readFile(join(userData, 'paired-hosts.json'), 'utf8')) as {
        hosts: { host: string; port: number; token?: string }[]
      }
      assert.equal(stored.hosts[0]?.token, 'tcTESTTOKEN')
      assert.equal(stored.hosts[0]?.host, '192.0.2.1')
      assert.notEqual(stored.hosts[0]?.host, '127.0.0.1')
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('pairs from a vav-remote QR payload through the tunnel', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service } = attach(userData, false, {
      dialTunnel: async () => ({ host: '127.0.0.1', port, close: () => undefined })
    })
    try {
      const parsed = parseMachinePairing(
        encodePairing({
          v: 1,
          token: 'tcQRTOKEN',
          secret: SECRET,
          host: 'Mac-mini-2.local'
        })
      )
      assert.ok(parsed?.token)
      const result = await service.pair(
        encodePairing({
          v: 1,
          token: 'tcQRTOKEN',
          secret: SECRET,
          host: 'Mac-mini-2.local'
        })
      )
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.host.id, 'box-1')
      const stored = JSON.parse(await readFile(join(userData, 'paired-hosts.json'), 'utf8')) as {
        hosts: { host: string; token?: string }[]
      }
      assert.equal(stored.hosts[0]?.token, 'tcQRTOKEN')
      assert.equal(stored.hosts[0]?.host, 'Mac-mini-2.local')
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('falls back to LAN when the tunnel dial fails', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service } = attach(userData, false, {
      dialTunnel: async () => {
        throw new Error('tailcat dial exited (1): dial: context deadline exceeded')
      }
    })
    try {
      const result = await service.pair(
        encodeDaemonPairing({
          v: DAEMON_PROTO_VERSION,
          secret: SECRET,
          machineId: 'ignored',
          name: 'box',
          host: '127.0.0.1',
          port,
          token: 'tcFAILTOKEN'
        })
      )
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.host.id, 'box-1')
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('falls back to a later address when the first host cannot be reached', async () => {
    const disk = await mkdtemp(join(tmpdir(), 'vav-box-'))
    const userData = await mkdtemp(join(tmpdir(), 'vav-attach-'))
    const { server, port } = await listenLoopback(disk)
    const { service } = attach(userData)
    try {
      const result = await service.pair(
        encodeDaemonPairing({
          v: DAEMON_PROTO_VERSION,
          secret: SECRET,
          machineId: 'ignored',
          name: 'box',
          host: '127.0.0.2',
          port,
          addresses: ['127.0.0.2', '127.0.0.1']
        })
      )
      assert.equal(result.ok, true)
      const stored = JSON.parse(await readFile(join(userData, 'paired-hosts.json'), 'utf8')) as {
        hosts: { host: string; port: number }[]
      }
      assert.equal(stored.hosts[0]?.host, '127.0.0.1')
      assert.equal(stored.hosts[0]?.port, port)
    } finally {
      service.dispose()
      server.close()
      await rm(disk, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('listens so another attach client can pair over LAN pairing text', async () => {
    const userA = await mkdtemp(join(tmpdir(), 'vav-a-'))
    const userB = await mkdtemp(join(tmpdir(), 'vav-b-'))
    const a = new DaemonAttachService({
      userData: userA,
      registry: new HostRegistry(),
      identityName: 'Alpha',
      secret: () => SECRET,
      appVersion: 'test',
      enabled: () => true,
      tailcatToken: () => null,
      onHostsChanged: () => undefined
    })
    const { service: b } = attach(userB)
    try {
      a.applySettings()
      const start = Date.now()
      while (!a.listenPortOf() && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      const pairing = a.pairing()
      assert.ok(pairing)
      const result = await b.pair(pairing)
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.host.name, 'Alpha')
        assert.equal(result.host.online, true)
        const home = b.homeOf(result.host.id)
        assert.ok(home.length > 0)
      }
    } finally {
      a.dispose()
      b.dispose()
      await rm(userA, { recursive: true, force: true })
      await rm(userB, { recursive: true, force: true })
    }
  })

  it('pairs over LAN after the other side confirms', async () => {
    const userA = await mkdtemp(join(tmpdir(), 'vav-a-'))
    const userB = await mkdtemp(join(tmpdir(), 'vav-b-'))
    const a = new DaemonAttachService({
      userData: userA,
      registry: new HostRegistry(),
      identityName: 'Alpha',
      secret: () => SECRET,
      appVersion: 'test',
      enabled: () => true,
      tailcatToken: () => null,
      onHostsChanged: () => undefined,
      confirmLanPair: async () => true
    })
    const { service: b } = attach(userB)
    try {
      a.applySettings()
      const start = Date.now()
      while (!a.listenPortOf() && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      const result = await b.pairLan({
        address: '127.0.0.1',
        port: a.listenPortOf(),
        name: 'client',
        machineId: 'client-1'
      })
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.host.name, 'Alpha')
    } finally {
      a.dispose()
      b.dispose()
      await rm(userA, { recursive: true, force: true })
      await rm(userB, { recursive: true, force: true })
    }
  })

  it('cancels an in-flight LAN pair', async () => {
    const userA = await mkdtemp(join(tmpdir(), 'vav-a-'))
    const userB = await mkdtemp(join(tmpdir(), 'vav-b-'))
    const a = new DaemonAttachService({
      userData: userA,
      registry: new HostRegistry(),
      identityName: 'Alpha',
      secret: () => SECRET,
      appVersion: 'test',
      enabled: () => true,
      tailcatToken: () => null,
      onHostsChanged: () => undefined,
      confirmLanPair: () => new Promise(() => undefined)
    })
    const { service: b } = attach(userB)
    try {
      a.applySettings()
      const start = Date.now()
      while (!a.listenPortOf() && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      const pending = b.pairLan({
        address: '127.0.0.1',
        port: a.listenPortOf(),
        name: 'client',
        machineId: 'client-1'
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      b.cancelPair()
      const result = await pending
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /cancelled/i)
    } finally {
      a.dispose()
      b.dispose()
      await rm(userA, { recursive: true, force: true })
      await rm(userB, { recursive: true, force: true })
    }
  })
})
