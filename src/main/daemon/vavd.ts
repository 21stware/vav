#!/usr/bin/env node
/**
 * Headless workspace-host daemon.
 *
 * Listens for desktop VAV clients on the daemon protocol. Pairing URI is
 * printed on stdout — paste it in the other machine's Connect → Connect to.
 *
 *   npm run vavd
 *   node --experimental-strip-types src/main/daemon/vavd.ts --port 4750
 *   vavd clients | unpair <id> | disconnect <id> | rotate-offer
 */

import { createInterface } from 'node:readline'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import {
  DAEMON_DEFAULT_PORT,
  DAEMON_PROTO_VERSION,
  encodeDaemonPairing
} from '../../shared/daemonProtocol.ts'
import { DaemonServer, DAEMON_LAN_BIND } from './DaemonServer.ts'
import { defaultHostName, loadOrCreateIdentity, loadOrCreateSecret, persistSecret } from './identity.ts'
import { advertisedPairingAddresses, startAnnouncer } from './lanAnnounce.ts'
import { createFileGrantStore } from './grants.ts'
import {
  adminHandlersFor,
  handleStdinLine,
  runVavdAdminCommand,
  startVavdAdmin,
  stopVavdAdmin
} from './vavdAdmin.ts'

function argValue(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function adminVerb(): {
  command: 'clients' | 'disconnect' | 'unpair' | 'rotate-offer'
  id?: string
} | null {
  const verbs = new Set(['clients', 'disconnect', 'unpair', 'rotate-offer'])
  const takesValue = new Set(['--state', '--port', '--listen', '--name'])
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (takesValue.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) continue
    if (verbs.has(arg)) {
      return {
        command: arg as 'clients' | 'disconnect' | 'unpair' | 'rotate-offer',
        id: process.argv[i + 1]?.startsWith('-') ? undefined : process.argv[i + 1]
      }
    }
  }
  return null
}

function printHelp(): void {
  process.stdout.write(
    [
      'vavd — VAV workspace-host daemon',
      '',
      '  --port <n>       listen port (default 4750)',
      '  --listen <addr>  bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)',
      '  --name <label>   machine name in pairing',
      '  --state <dir>    identity + secret dir (default ~/.vavd)',
      '  --no-announce    skip LAN multicast',
      '',
      '  clients          list authorized computers',
      '  disconnect <id>  drop live sockets; grant remains',
      '  unpair <id>      revoke a computer’s grant',
      '  rotate-offer     invalidate the printed pairing URI; existing grants stay',
      ''
    ].join('\n')
  )
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp()
    return
  }

  const stateDir = argValue('--state', join(homedir(), '.vavd')) ?? join(homedir(), '.vavd')
  const verb = adminVerb()
  if (verb) {
    const text = await runVavdAdminCommand(stateDir, verb.command, verb.id)
    process.stdout.write(text)
    return
  }

  const name = argValue('--name') || defaultHostName()
  const identity = loadOrCreateIdentity(stateDir, name)
  let secret = loadOrCreateSecret(stateDir)
  const grants = createFileGrantStore(stateDir)
  const portRaw = argValue('--port')
  const portParsed = portRaw === undefined ? DAEMON_DEFAULT_PORT : Number(portRaw)
  const port = Number.isFinite(portParsed) ? portParsed : DAEMON_DEFAULT_PORT
  const bind = argValue('--listen', DAEMON_LAN_BIND) ?? DAEMON_LAN_BIND

  const host = createLocalWorkspaceHost({ name: identity.name })
  let bound = port
  const pairingOf = (auth = secret): string => {
    const advertised = advertisedPairingAddresses({ identityName: identity.name })
    return encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: auth,
      machineId: identity.machineId,
      name: identity.name,
      host: advertised.host,
      port: bound,
      addresses: advertised.addresses
    })
  }

  const server = new DaemonServer({
    host,
    identity,
    secret: () => secret,
    grants,
    appVersion: process.env.npm_package_version || '0.0.0',
    home: homedir(),
    tmp: tmpdir(),
    pairing: (grantSecret) => pairingOf(grantSecret || secret)
  })

  bound = await server.listen(port, bind)

  if (!hasFlag('--no-announce')) {
    startAnnouncer({
      v: DAEMON_PROTO_VERSION,
      kind: 'vav-daemon',
      machineId: identity.machineId,
      name: identity.name,
      port: bound,
      platform: process.platform
    })
  }

  const rotateOffer = (): string => {
    secret = randomBytes(24).toString('base64url')
    persistSecret(stateDir, secret)
    process.stdout.write(`${pairingOf(secret)}\n`)
    return secret
  }

  const handlers = adminHandlersFor(server, rotateOffer)
  const admin = await startVavdAdmin(stateDir, handlers)

  process.stdout.write(`vavd listening on ${bind}:${bound}\n`)
  process.stdout.write(`${pairingOf(secret)}\n`)
  process.stdout.write('Paste that URI in VAV → Connect → Connect to → Pair.\n')
  process.stdout.write('Type clients / disconnect <id> / unpair <id> / rotate-offer.\n')

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on('line', (line) => {
      process.stdout.write(handleStdinLine(line, handlers))
    })
  }

  const shutdown = (): void => {
    stopVavdAdmin(stateDir, admin)
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
