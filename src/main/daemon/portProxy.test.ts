import assert from 'node:assert/strict'
import { createConnection, createServer, type AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer } from './DaemonServer.ts'
import { openPortProxy } from './portProxy.ts'

const SECRET = '0123456789abcdef01234567'

describe('portProxy', () => {
  const temps: string[] = []
  after(async () => {
    await Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('pipes bytes to a loopback target after proxy hello', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-proxy-'))
    temps.push(dir)
    const echo = createServer((socket) => {
      socket.on('data', (chunk) => socket.write(chunk))
    })
    const echoPort = await new Promise<number>((resolve, reject) => {
      echo.once('error', reject)
      echo.listen(0, '127.0.0.1', () => resolve((echo.address() as AddressInfo).port))
    })
    const daemon = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir
    })
    const daemonPort = await daemon.listen(0, '127.0.0.1')
    try {
      const remote = await openPortProxy(
        { host: '127.0.0.1', port: daemonPort, secret: SECRET },
        echoPort
      )
      const reply = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('echo timeout')), 2000)
        timer.unref?.()
        remote.once('data', (chunk) => {
          clearTimeout(timer)
          resolve(chunk.toString('utf8'))
        })
        remote.once('error', reject)
        remote.write('ping-proxy')
      })
      assert.equal(reply, 'ping-proxy')
      remote.destroy()
    } finally {
      daemon.close()
      await new Promise<void>((resolve) => echo.close(() => resolve()))
    }
  })

  it('rejects a non-loopback proxy target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-proxy-deny-'))
    temps.push(dir)
    const daemon = new DaemonServer({
      host: createLocalWorkspaceHost({ name: 'loop' }),
      identity: { machineId: 'loop-box', name: 'loop' },
      secret: () => SECRET,
      appVersion: 'test',
      home: dir,
      tmp: dir
    })
    const daemonPort = await daemon.listen(0, '127.0.0.1')
    try {
      await assert.rejects(
        () =>
          new Promise<void>((resolve, reject) => {
            const socket = createConnection({ host: '127.0.0.1', port: daemonPort })
            socket.on('connect', () => {
              socket.write(
                `${JSON.stringify({
                  type: 'hello',
                  proto: 1,
                  auth: SECRET,
                  role: 'proxy',
                  targetPort: 80,
                  targetHost: '10.0.0.4'
                })}\n`
              )
            })
            let buf = ''
            socket.setEncoding('utf8')
            socket.on('data', (chunk: string) => {
              buf += chunk
              const idx = buf.indexOf('\n')
              if (idx < 0) return
              socket.destroy()
              try {
                const frame = JSON.parse(buf.slice(0, idx)) as { type?: string; message?: string }
                if (frame.type === 'error') reject(new Error(frame.message))
                else resolve()
              } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)))
              }
            })
            socket.on('error', reject)
          }),
        /loopback/
      )
    } finally {
      daemon.close()
    }
  })
})
