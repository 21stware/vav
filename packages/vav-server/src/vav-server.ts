#!/usr/bin/env node
/**
 * Headless VAV daemon.
 *
 * Hosts the workspace plane (fs / spawn / pty) and the session plane
 * (send / thread / live turn). Pair from a desktop or phone with the
 * printed URI. The local web UI and Chrome extension discover a loopback
 * daemon automatically.
 *
 *   npm run vav-server
 *   npx @21stware/vav-server
 *   vav-server --web-port 4752
 */

import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createLocalWorkspaceHost } from '@main/host/WorkspaceHost.ts'
import { createVavControlPlane } from '@main/host/VavControlPlane.ts'
import {
  DAEMON_DEFAULT_PORT,
  DAEMON_PROTO_VERSION,
  encodeDaemonPairing
} from '@shared/daemonProtocol.ts'
import { DaemonServer, DAEMON_LAN_BIND } from '@main/daemon/DaemonServer.ts'
import { loadOrCreateIdentity, loadOrCreateSecret, persistSecret } from '@main/daemon/identity.ts'
import { advertisedPairingAddresses, startAnnouncer } from '@main/daemon/lanAnnounce.ts'
import { createFileGrantStore } from '@main/daemon/grants.ts'
import {
  adminHandlersFor,
  handleStdinLine,
  runVavServerAdminCommand,
  startVavServerAdmin,
  stopVavServerAdmin
} from '@main/daemon/vavServerAdmin.ts'
import { startVavWebBridge } from '@main/daemon/VavWebBridge.ts'
import { VAV_SERVER_WEB_DEFAULT_PORT, webScanPorts } from '@shared/vavDiscover.ts'
import { clearListenState, probeListenAlive, readListenState, writeListenState } from '@main/daemon/listenState.ts'
import {
  DEFAULT_PROFILE,
  createProfile,
  listProfileStatuses,
  removeProfile,
  resolveProfileStateDir,
  startProfileDetached,
  stopProfile,
  type ProfileStatus
} from '@main/daemon/serverProfiles.ts'

function argValue(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

const ADMIN_VERBS = new Set(['clients', 'disconnect', 'unpair', 'rotate-offer'])
const MGMT_VERBS = new Set(['ls', 'list', 'ps', 'create', 'rm', 'remove', 'start', 'stop'])
const VALUE_FLAGS = new Set([
  '--state',
  '--profile',
  '--port',
  '--listen',
  '--name',
  '--web-port',
  '--web-listen',
  '--api-key',
  '--api-endpoint'
])

function positionalArgs(): string[] {
  const out: string[] = []
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (VALUE_FLAGS.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) continue
    out.push(arg)
  }
  return out
}

function firstVerb(): { verb: string; args: string[] } | null {
  const positional = positionalArgs()
  return positional.length ? { verb: positional[0]!, args: positional.slice(1) } : null
}

/** Runtime flags to forward when `start`ing a profile in the background. */
function passthroughRunFlags(): string[] {
  const out: string[] = []
  for (const flag of ['--port', '--listen', '--web-port', '--web-listen', '--name']) {
    const value = argValue(flag)
    if (value !== undefined) out.push(flag, value)
  }
  if (hasFlag('--no-web')) out.push('--no-web')
  if (hasFlag('--no-announce')) out.push('--no-announce')
  if (hasFlag('--force')) out.push('--force')
  return out
}

function profilePairing(dir: string): string | null {
  const listen = readListenState(dir)
  if (!listen) return null
  let secret: string | undefined
  try {
    secret = (JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8')) as { secret?: string }).secret
  } catch {
    secret = undefined
  }
  if (!secret) return null
  let ident: { machineId?: string; name?: string } = {}
  try {
    ident = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8'))
  } catch {
    ident = {}
  }
  if (!ident.machineId) return null
  const loopback = listen.host === '127.0.0.1' || listen.host === 'localhost' || listen.host === '::1'
  return encodeDaemonPairing({
    v: DAEMON_PROTO_VERSION,
    secret,
    machineId: ident.machineId,
    name: ident.name || 'vav-server',
    host: loopback ? '127.0.0.1' : listen.host,
    port: listen.port,
    addresses: loopback ? ['127.0.0.1'] : undefined
  })
}

function formatProfileTable(rows: ProfileStatus[]): string {
  const header = ['NAME', 'STATUS', 'ADDRESS', 'PID', 'LABEL']
  const data = rows.map((row) => [
    row.name,
    row.running ? 'running' : 'stopped',
    row.running && row.listen ? `${row.listen.host}:${row.listen.port}` : '-',
    row.running && row.listen?.pid ? String(row.listen.pid) : '-',
    row.displayName || '-'
  ])
  const widths = header.map((head, i) => Math.max(head.length, ...data.map((cols) => cols[i]!.length)))
  const line = (cols: string[]): string => cols.map((col, i) => col.padEnd(widths[i]!)).join('  ').trimEnd()
  return [line(header), ...data.map(line)].join('\n') + '\n'
}

/** Handle docker-style profile verbs. Returns true when a verb was handled. */
async function runProfileCommand(verb: string, args: string[]): Promise<void> {
  switch (verb) {
    case 'ls':
    case 'list':
    case 'ps': {
      process.stdout.write(formatProfileTable(await listProfileStatuses()))
      return
    }
    case 'create': {
      const name = args[0]
      if (!name) throw new Error('usage: vav-server create <name>')
      const created = createProfile(name, { home: homedir(), label: argValue('--name') })
      process.stdout.write(`created profile ${created.name} → ${created.dir}\n`)
      return
    }
    case 'rm':
    case 'remove': {
      const name = args[0]
      if (!name) throw new Error('usage: vav-server rm <name>')
      await removeProfile(name, { force: hasFlag('--force') })
      process.stdout.write(`removed profile ${name}\n`)
      return
    }
    case 'start': {
      const name = args[0] || DEFAULT_PROFILE
      const status = await startProfileDetached(name, { extraFlags: passthroughRunFlags() })
      const addr = status.listen ? `${status.listen.host}:${status.listen.port}` : '?'
      process.stdout.write(
        `started ${status.name} → ${addr}${status.listen?.pid ? ` (pid ${status.listen.pid})` : ''}\n`
      )
      const pairing = profilePairing(status.dir)
      if (pairing) process.stdout.write(`${pairing}\n`)
      return
    }
    case 'stop': {
      const name = args[0] || DEFAULT_PROFILE
      const result = await stopProfile(name)
      process.stdout.write(
        result.stopped ? `stopped ${name}${result.pid ? ` (pid ${result.pid})` : ''}\n` : `${name} is not running\n`
      )
      return
    }
    default:
      throw new Error(`unknown command: ${verb}`)
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'vav-server — headless VAV',
      '',
      '  --port <n>          daemon / control listen port (default 4750)',
      '  --listen <addr>     bind address (default 0.0.0.0 — LAN; 127.0.0.1 for local-only)',
      '  --web-port <n>      HTTP + WebSocket UI (default 4752; 0 = ephemeral)',
      '  --web-listen <addr> web bind (default 127.0.0.1)',
      '  --name <label>      machine name in pairing',
      '  --profile <name>    named profile under ~/.vav/servers/<name> (default: default)',
      '  --state <dir>       explicit state dir (overrides --profile)',
      '  --api-key <key>     VAV provider key (or VAV_API_KEY)',
      '  --api-endpoint <url> provider root (or VAV_API_ENDPOINT)',
      '  --no-announce       skip LAN multicast',
      '  --no-web            disable the web UI',
      '  --force             start even if listen.json still points at a live process',
      '',
      'Profiles (docker-style, persisted under ~/.vav/servers/<name>):',
      '  ls                 list profiles with status / address / pid',
      '  create <name>      create a profile (does not start it)',
      '  start [name]       start a profile in the background (default: default)',
      '  stop [name]        stop a running profile',
      '  rm <name>          remove a profile (--force to stop + remove)',
      '',
      'Admin (targets --profile / --state, default: default):',
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

  const command = firstVerb()
  if (command && MGMT_VERBS.has(command.verb)) {
    await runProfileCommand(command.verb, command.args)
    return
  }

  const stateDir = resolveProfileStateDir({
    stateFlag: argValue('--state'),
    profile: argValue('--profile')
  })

  if (command && ADMIN_VERBS.has(command.verb)) {
    const text = await runVavServerAdminCommand(
      stateDir,
      command.verb as 'clients' | 'disconnect' | 'unpair' | 'rotate-offer',
      command.args[0]
    )
    process.stdout.write(text)
    return
  }

  const cliKey = argValue('--api-key')
  if (cliKey) process.env.VAV_API_KEY = cliKey
  const cliEndpoint = argValue('--api-endpoint')
  if (cliEndpoint) process.env.VAV_API_ENDPOINT = cliEndpoint

  // Only override a stored label when --name is passed; otherwise keep the
  // profile's identity (so `create --name` / prior runs are not clobbered).
  const identity = loadOrCreateIdentity(stateDir, argValue('--name'))
  let secret = loadOrCreateSecret(stateDir)
  const grants = createFileGrantStore(stateDir)
  const portRaw = argValue('--port')
  const portParsed = portRaw === undefined ? DAEMON_DEFAULT_PORT : Number(portRaw)
  const port = Number.isFinite(portParsed) ? portParsed : DAEMON_DEFAULT_PORT
  const bind = argValue('--listen', DAEMON_LAN_BIND) ?? DAEMON_LAN_BIND

  const existing = readListenState(stateDir)
  if (existing && (await probeListenAlive(existing)) && !hasFlag('--force')) {
    const loopback = existing.host === '127.0.0.1' || existing.host === 'localhost' || existing.host === '::1'
    process.stdout.write(`vav-server already running on ${existing.host}:${existing.port}\n`)
    process.stdout.write(
      `${encodeDaemonPairing({
        v: DAEMON_PROTO_VERSION,
        secret,
        machineId: identity.machineId,
        name: identity.name,
        host: loopback ? '127.0.0.1' : existing.host,
        port: existing.port,
        addresses: loopback ? ['127.0.0.1'] : undefined
      })}\n`
    )
    return
  }

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
    if (loopback) {
      return encodeDaemonPairing({
        v: DAEMON_PROTO_VERSION,
        secret: auth,
        machineId: identity.machineId,
        name: identity.name,
        host: '127.0.0.1',
        port: bound,
        addresses: ['127.0.0.1']
      })
    }
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

  const rotateSecret = (): string => {
    secret = randomBytes(24).toString('base64url')
    persistSecret(stateDir, secret)
    return secret
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
    rotateOffer: () => {
      rotateSecret()
      return pairingOf(secret)
    },
    catalog: plane.catalog,
    logs: plane.logs,
    plugins: plane.plugins,
    timers: plane.timerCatalog,
    connectors: plane.connectorCatalog,
    fileSessions: plane.fileSessionCatalog,
    changeSets: plane.changeSetCatalog,
    accounts: plane.accountsCatalog,
    settings: plane.settingsCatalog,
    onControlHello: (socket, leftover, hello) => plane.hub.adoptAuthed(socket, leftover, hello)
  })

  bound = await server.listen(port, bind)
  writeListenState(stateDir, { host: bind === '0.0.0.0' ? '127.0.0.1' : bind, port: bound })

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
  const webPortParsed = webPortRaw === undefined ? VAV_SERVER_WEB_DEFAULT_PORT : Number(webPortRaw)
  const webPort = Number.isFinite(webPortParsed) ? webPortParsed : VAV_SERVER_WEB_DEFAULT_PORT
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
          attachSocket: (socket) => server.attachIncoming(socket),
          secret: () => secret,
          name: identity.name,
          version: process.env.npm_package_version || '0.0.0',
          daemonPort: bound,
          hasKey: () => plane.hasApiKey()
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
    const next = rotateSecret()
    process.stdout.write(`${pairingOf(next)}\n`)
    return next
  }

  const handlers = adminHandlersFor(server, rotateOffer)
  const admin = await startVavServerAdmin(stateDir, handlers)

  process.stdout.write(`vav-server listening on ${bind}:${bound}\n`)
  if (web) process.stdout.write(`vav-server web on http://${webListen}:${web.port}\n`)
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
    clearListenState(stateDir)
    stopVavServerAdmin(stateDir, admin)
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
