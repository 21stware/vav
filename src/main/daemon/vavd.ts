#!/usr/bin/env node
/**
 * Headless VAV daemon.
 *
 * Hosts the workspace plane (fs / spawn / pty) and the session plane
 * (send / thread / live turn). Pair from a desktop, phone, web page, or
 * Chrome extension with the printed URI.
 *
 *   npm run vavd
 *   npx @21stware/vavd
 *   vavd --web-port 4752
 */

import { createInterface, type Interface } from 'node:readline'
import { homedir, tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import { createVavControlPlane } from '../host/VavControlPlane.ts'
import { DAEMON_PROTO_VERSION, encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import { DaemonServer } from './DaemonServer.ts'
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
import {
  formatListenError,
  formatVavdHelp,
  parseVavdArgs,
  resolveVavdVersion,
  type VavdServeOptions
} from './vavdArgs.ts'

async function main(): Promise<void> {
  const parsed = parseVavdArgs(process.argv)
  if (parsed.kind === 'help') {
    process.stdout.write(formatVavdHelp())
    return
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`vavd ${resolveVavdVersion()}\n`)
    return
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`)
    process.stderr.write('Try vavd --help.\n')
    process.exitCode = 1
    return
  }
  if (parsed.kind === 'admin') {
    const text = await runVavdAdminCommand(parsed.stateDir, parsed.command, parsed.id)
    process.stdout.write(text)
    return
  }

  await serve(parsed.options)
}

async function serve(options: VavdServeOptions): Promise<void> {
  if (options.apiKey) process.env.VAV_API_KEY = options.apiKey
  if (options.apiEndpoint) process.env.VAV_API_ENDPOINT = options.apiEndpoint

  const stateDir = options.stateDir
  const version = resolveVavdVersion()
  const name = options.name || defaultHostName()
  const identity = loadOrCreateIdentity(stateDir, name)
  let secret = loadOrCreateSecret(stateDir)
  const grants = createFileGrantStore(stateDir)

  const host = createLocalWorkspaceHost({ name: identity.name })
  const plane = createVavControlPlane({
    stateDir,
    host,
    secret: () => secret,
    appVersion: version,
    home: homedir(),
    tmp: tmpdir(),
    extraAuth: (auth) => grants.findBySecret(auth) != null
  })
  plane.load()

  let bound = options.port
  const pairingOf = (auth = secret): string => {
    const loopback = options.listen === '127.0.0.1' || options.listen === 'localhost' || options.listen === '::1'
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
    appVersion: version,
    home: homedir(),
    tmp: tmpdir(),
    pairing: (grantSecret) => pairingOf(grantSecret || secret),
    catalog: plane.catalog,
    onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
  })

  try {
    bound = await server.listen(options.port, options.listen)
  } catch (err) {
    throw new Error(formatListenError(err, 'vavd', options.listen, options.port))
  }

  if (options.announce) {
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
  if (options.web) {
    try {
      web = await startVavWebBridge({
        listen: options.webListen,
        port: options.webPort,
        hub: plane.hub,
        secret: () => secret
      })
    } catch (err) {
      server.close()
      plane.dispose()
      throw new Error(formatListenError(err, 'web UI', options.webListen, options.webPort))
    }
  }

  const rotateOffer = (): { secret: string; pairing: string } => {
    secret = randomBytes(24).toString('base64url')
    persistSecret(stateDir, secret)
    return { secret, pairing: pairingOf(secret) }
  }

  const handlers = adminHandlersFor(server, rotateOffer)
  const admin = await startVavdAdmin(stateDir, handlers)

  const pairing = pairingOf(secret)
  if (options.quiet) {
    process.stdout.write(`${pairing}\n`)
  } else {
    process.stdout.write(`vavd listening on ${options.listen}:${bound}\n`)
    if (web) process.stdout.write(`vavd web on http://${options.webListen}:${web.port}\n`)
    process.stdout.write(`${pairing}\n`)
    process.stdout.write('Paste that URI in VAV → Connect, VAV Remote, the web UI, or the Chrome extension.\n')
    process.stdout.write('Type clients / disconnect <id> / unpair <id> / rotate-offer.\n')
  }

  let rl: Interface | null = null
  if (process.stdin.isTTY) {
    rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on('line', (line) => {
      process.stdout.write(handleStdinLine(line, handlers))
    })
  }

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    rl?.close()
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
