#!/usr/bin/env node
/**
 * Headless VAV daemon.
 *
 * Hosts the workspace plane (fs / spawn / pty) and the session plane
 * (send / thread / live turn). Pair from a desktop or phone with the
 * printed URI. The local web UI and Chrome extension discover a loopback
 * daemon automatically.
 *
 *   npm run vavd
 *   npx @21stware/vavd
 *   vavd --web-port 4752
 */

import { createInterface } from 'node:readline'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
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
import { startVavWebBridge } from './VavWebBridge.ts'
import { VAVD_WEB_DEFAULT_PORT, webScanPorts } from '../../shared/vavDiscover.ts'

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
  const takesValue = new Set([
    '--state',
    '--port',
    '--listen',
    '--name',
    '--web-port',
    '--web-listen',
    '--api-key',
    '--api-endpoint'
  ])
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
      'vavd — headless VAV',
      '',
      '  --port <n>          daemon / control listen port (default 4750)',
      '  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)',
      '  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)',
      '  --web-listen <addr> web bind (default 127.0.0.1)',
      '  --name <label>      machine name in pairing',
      '  --state <dir>       identity + secrets + sessions (default ~/.vavd)',
      '  --api-key <key>     VAV provider key (or VAV_API_KEY)',
      '  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)',
      '  --no-announce       skip LAN multicast',
      '  --no-web            disable the web UI',
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

  const cliKey = argValue('--api-key')
  if (cliKey) process.env.VAV_API_KEY = cliKey
  const cliEndpoint = argValue('--api-endpoint')
  if (cliEndpoint) process.env.VAV_API_ENDPOINT = cliEndpoint

  const name = argValue('--name') || defaultHostName()
  const identity = loadOrCreateIdentity(stateDir, name)
  let secret = loadOrCreateSecret(stateDir)
  const grants = createFileGrantStore(stateDir)
  const portRaw = argValue('--port')
  const portParsed = portRaw === undefined ? DAEMON_DEFAULT_PORT : Number(portRaw)
  const port = Number.isFinite(portParsed) ? portParsed : DAEMON_DEFAULT_PORT
  const bind = argValue('--listen', DAEMON_LAN_BIND) ?? DAEMON_LAN_BIND

  const host = createLocalWorkspaceHost({ name: identity.name })
  const plane = createVavControlPlane({
    stateDir,
    host,
    secret: () => secret,
    appVersion: process.env.npm_package_version || '0.0.0',
    home: homedir(),
    tmp: tmpdir(),
    extraAuth: (auth) => grants.findBySecret(auth) != null
  })
  plane.load()

  let bound = port
  const pairingOf = (auth = secret): string => {
    const loopback = bind === '127.0.0.1' || bind === 'localhost' || bind === '::1'
    const advertised = advertisedPairingAddresses({ identityName: identity.name })
    return encodeDaemonPairing({
      v: DAEMON_PROTO_VERSION,
      secret: auth,
      machineId: identity.machineId,
      name: identity.name,
      host: loopback ? '127.0.0.1' : advertised.host,
      port: bound,
      addresses: loopback ? ['127.0.0.1'] : advertised.addresses
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
    pairing: (grantSecret) => pairingOf(grantSecret || secret),
    catalog: plane.catalog,
    onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
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

  let web: { close: () => void; port: number } | null = null
  const webDisabled = hasFlag('--no-web')
  const webPortRaw = argValue('--web-port')
  const webPortParsed = webPortRaw === undefined ? VAVD_WEB_DEFAULT_PORT : Number(webPortRaw)
  const webPort = Number.isFinite(webPortParsed) ? webPortParsed : VAVD_WEB_DEFAULT_PORT
  const webListen = argValue('--web-listen', '127.0.0.1') ?? '127.0.0.1'
  if (!webDisabled) {
    const ports = webPort === 0 ? [0] : webScanPorts([webPort])
    let lastError: unknown
    for (const port of ports) {
      try {
        web = await startVavWebBridge({
          listen: webListen,
          port,
          hub: plane.hub,
          secret: () => secret,
          name: identity.name,
          version: process.env.npm_package_version || '0.0.0'
        })
        lastError = undefined
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!web && lastError) throw lastError
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
  if (web) process.stdout.write(`vavd web on http://${webListen}:${web.port}\n`)
  process.stdout.write(`${pairingOf(secret)}\n`)
  process.stdout.write(
    'Paste that URI in VAV → Connect or VAV Remote. The local web UI and Chrome extension find this machine automatically.\n'
  )
  process.stdout.write('Type clients / disconnect <id> / unpair <id> / rotate-offer.\n')

  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on('line', (line) => {
      process.stdout.write(handleStdinLine(line, handlers))
    })
  }

  const shutdown = (): void => {
    stopVavdAdmin(stateDir, admin)
    web?.close()
    plane.dispose()
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
