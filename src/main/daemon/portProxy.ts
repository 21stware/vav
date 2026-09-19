/**
 * Client side of `hello.role=proxy`: one extra TCP connection to the paired
 * daemon, then a raw byte pipe to that host's loopback port.
 */

import { createConnection, type Socket } from 'node:net'
import { DAEMON_PROTO_VERSION, parseDaemonServerFrame } from '../../shared/daemonProtocol.ts'
import { encodeDaemonLine } from '../../shared/daemonProtocol.ts'
import { isLoopbackProxyTarget } from '../../shared/ptyPorts.ts'

export type PortProxyDial = {
  host: string
  port: number
  secret: string
  grantId?: string
  clientId?: string
  device?: string
}

const PROXY_HELLO_MS = 8_000

function readFirstLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      fail(new Error('proxy hello timed out'))
    }, timeoutMs)
    timer.unref?.()
    const fail = (err: Error): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      reject(err)
    }
    const onError = (err: Error): void => fail(err)
    const onData = (chunk: string): void => {
      buf += chunk
      const idx = buf.indexOf('\n')
      if (idx < 0) return
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.setEncoding()
      const line = buf.slice(0, idx)
      const rest = buf.slice(idx + 1)
      if (rest) socket.unshift(Buffer.from(rest, 'utf8'))
      resolve(line)
    }
    socket.setEncoding('utf8')
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

export function openPortProxy(dial: PortProxyDial, targetPort: number): Promise<Socket> {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    return Promise.reject(new Error('invalid proxy target port'))
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: dial.host, port: dial.port })
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(err)
    }
    socket.once('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
    socket.once('connect', () => {
      socket.write(
        encodeDaemonLine({
          type: 'hello',
          proto: DAEMON_PROTO_VERSION,
          auth: dial.secret,
          role: 'proxy',
          targetPort,
          targetHost: '127.0.0.1',
          device: dial.device,
          clientId: dial.clientId,
          grantId: dial.grantId
        })
      )
      void readFirstLine(socket, PROXY_HELLO_MS).then((line) => {
        if (settled) return
        let value: unknown
        try {
          value = JSON.parse(line) as unknown
        } catch {
          fail(new Error('invalid proxy hello'))
          return
        }
        const frame = parseDaemonServerFrame(value)
        if (frame?.type === 'error') {
          fail(new Error(frame.message))
          return
        }
        if (frame?.type !== 'welcome') {
          fail(new Error('proxy hello rejected'))
          return
        }
        settled = true
        resolve(socket)
      }, fail)
    })
  })
}

export function pipeSockets(a: Socket, b: Socket): void {
  const close = (): void => {
    a.destroy()
    b.destroy()
  }
  a.on('error', close)
  b.on('error', close)
  a.on('close', close)
  b.on('close', close)
  a.pipe(b)
  b.pipe(a)
}

export { isLoopbackProxyTarget }
