/**
 * Local admin channel for a running vavd (list / disconnect / unpair / rotate).
 * `vavd clients` talks to 127.0.0.1 via `admin.json`. If nothing is listening,
 * list/unpair edit `grants.json` on disk.
 */

import { randomBytes } from 'node:crypto'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createFileGrantStore, incomingFromGrants, type IncomingController } from './grants.ts'
import { persistSecret } from './identity.ts'
import { writePrivateJson } from './identity.ts'
import { attachLineReader, writeLine } from './jsonLines.ts'
import type { DaemonServer } from './DaemonServer.ts'

export type VavdAdminHandlers = {
  incoming: () => IncomingController[]
  disconnect: (id: string) => boolean
  unpair: (id: string) => boolean
  rotateOffer: () => string
}

const ADMIN_FILE = 'admin.json'

export function adminFile(stateDir: string): string {
  return join(stateDir, ADMIN_FILE)
}

export function startVavdAdmin(stateDir: string, handlers: VavdAdminHandlers): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => attachAdminClient(socket, handlers))
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('vavd admin: no address'))
        return
      }
      writePrivateJson(adminFile(stateDir), { port: address.port })
      resolve(server)
    })
  })
}

export function stopVavdAdmin(stateDir: string, server: Server | null): void {
  try {
    rmSync(adminFile(stateDir), { force: true })
  } catch {
    /* ignore */
  }
  server?.close()
}

function attachAdminClient(socket: Socket, handlers: VavdAdminHandlers): void {
  attachLineReader(socket, (value) => {
    if (value === null || typeof value !== 'object') {
      writeLine(socket, { type: 'error', message: 'invalid json' })
      socket.end()
      return
    }
    const raw = value as Record<string, unknown>
    const reply = handleAdmin(raw, handlers)
    writeLine(socket, reply)
    socket.end()
  })
}

function handleAdmin(raw: Record<string, unknown>, handlers: VavdAdminHandlers): Record<string, unknown> {
  switch (raw.type) {
    case 'clients':
      return { type: 'ok', clients: handlers.incoming() }
    case 'disconnect': {
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (!id) return { type: 'error', message: 'missing id' }
      return { type: 'ok', ok: handlers.disconnect(id) }
    }
    case 'unpair': {
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (!id) return { type: 'error', message: 'missing id' }
      return { type: 'ok', ok: handlers.unpair(id) }
    }
    case 'rotate-offer':
      return { type: 'ok', secret: handlers.rotateOffer() }
    default:
      return { type: 'error', message: `unknown command: ${String(raw.type)}` }
  }
}

export async function runVavdAdminCommand(
  stateDir: string,
  command: 'clients' | 'disconnect' | 'unpair' | 'rotate-offer',
  id?: string
): Promise<string> {
  const live = readAdminPort(stateDir)
  if (live) {
    const result = await askAdmin(live, command, id)
    return formatAdminResult(command, result)
  }
  return runOfflineAdmin(stateDir, command, id)
}

function readAdminPort(stateDir: string): number | null {
  try {
    if (!existsSync(adminFile(stateDir))) return null
    const raw = JSON.parse(readFileSync(adminFile(stateDir), 'utf8')) as { port?: unknown }
    return typeof raw.port === 'number' && raw.port > 0 ? raw.port : null
  } catch {
    return null
  }
}

function askAdmin(
  port: number,
  command: string,
  id?: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('vavd admin timed out'))
    }, 2000)
    timer.unref?.()
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    socket.on('connect', () => {
      writeLine(socket, id ? { type: command, id } : { type: command })
    })
    attachLineReader(socket, (value) => {
      clearTimeout(timer)
      socket.destroy()
      if (value === null || typeof value !== 'object') {
        reject(new Error('invalid admin reply'))
        return
      }
      resolve(value as Record<string, unknown>)
    })
  })
}

function runOfflineAdmin(
  stateDir: string,
  command: 'clients' | 'disconnect' | 'unpair' | 'rotate-offer',
  id?: string
): string {
  const grants = createFileGrantStore(stateDir)
  if (command === 'clients') {
    return formatClients(incomingFromGrants(grants.list(), new Set()))
  }
  if (command === 'disconnect') {
    return 'vavd is not running — nothing to disconnect.\n'
  }
  if (command === 'unpair') {
    if (!id) return 'usage: vavd unpair <grant-id>\n'
    const grant = grants.remove(id) || grants.list().find((row) => row.name === id)
    if (grant && grant.id !== id) grants.remove(grant.id)
    if (!grant) return `no grant ${id}\n`
    return `unpaired ${grant.name} (${grant.id})\n`
  }
  persistSecret(stateDir, randomBytes(24).toString('base64url'))
  return `rotated offer. next pairing line will use the new secret.\n`
}

function formatAdminResult(command: string, result: Record<string, unknown>): string {
  if (result.type === 'error') return `${String(result.message)}\n`
  if (command === 'clients') {
    const clients = Array.isArray(result.clients) ? (result.clients as IncomingController[]) : []
    return formatClients(clients)
  }
  if (command === 'rotate-offer') return 'rotated offer. print a new pairing line from the running process.\n'
  return result.ok === false ? 'not found\n' : 'ok\n'
}

export function formatClients(rows: IncomingController[]): string {
  if (rows.length === 0) return 'no paired computers\n'
  const online = rows.filter((row) => row.state === 'online').length
  const warning =
    online > 1
      ? `warning: ${online} computers are online and share this machine’s files.\n`
      : ''
  const lines = rows
    .map(
      (row) =>
        `${row.id}  ${row.state.padEnd(8)}  ${row.name}  lastSeen=${new Date(row.lastSeen).toISOString()}`
    )
    .join('\n')
  return `${warning}${lines}\n`
}

export function handleStdinLine(
  line: string,
  handlers: VavdAdminHandlers
): string {
  const parts = line.trim().split(/\s+/)
  const command = parts[0]
  if (!command || command === 'help') {
    return 'commands: clients | disconnect <id> | unpair <id> | rotate-offer\n'
  }
  if (command === 'clients' || command === 'list') return formatClients(handlers.incoming())
  if (command === 'disconnect' || command === 'unpair') {
    const id = parts[1]
    if (!id) return `usage: ${command} <grant-id>\n`
    const ok = command === 'disconnect' ? handlers.disconnect(id) : handlers.unpair(id)
    return ok ? 'ok\n' : 'not found\n'
  }
  if (command === 'rotate-offer' || command === 'rotate') {
    handlers.rotateOffer()
    return 'rotated offer\n'
  }
  return `unknown command: ${command}\n`
}

/** Used by the long-running daemon so stdin and the admin port share one implementation. */
function resolveGrantId(server: DaemonServer, idOrName: string): string | null {
  if (server.incoming().some((row) => row.id === idOrName)) return idOrName
  return server.incoming().find((row) => row.name === idOrName)?.id ?? null
}

export function adminHandlersFor(server: DaemonServer, rotateOffer: () => string): VavdAdminHandlers {
  return {
    incoming: () => server.incoming(),
    disconnect: (id) => {
      const grantId = resolveGrantId(server, id)
      return grantId ? server.disconnectGrant(grantId) : false
    },
    unpair: (id) => {
      const grantId = resolveGrantId(server, id)
      return grantId ? server.unpairGrant(grantId) : false
    },
    rotateOffer
  }
}
