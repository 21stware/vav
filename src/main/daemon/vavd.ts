#!/usr/bin/env node
/**
 * Headless workspace-host daemon.
 *
 * Listens for desktop VAV clients on the daemon protocol. Pairing payload is
 * printed on stdout — paste it in the other machine's Settings → Machines.
 *
 *   npm run vavd
 *   node --experimental-strip-types src/main/daemon/vavd.ts --port 4750
 */

import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalWorkspaceHost } from '../host/WorkspaceHost.ts'
import {
  DAEMON_DEFAULT_PORT,
  DAEMON_PROTO_VERSION,
  encodeDaemonPairing
} from '../../shared/daemonProtocol.ts'
import { DaemonServer } from './DaemonServer.ts'
import { defaultHostName, loadOrCreateIdentity, loadOrCreateSecret } from './identity.ts'
import { lanAddresses, startAnnouncer } from './lanAnnounce.ts'

function argValue(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(
      [
        'vavd — VAV workspace-host daemon',
        '',
        '  --port <n>       listen port (default 4750)',
        '  --listen <addr>  bind address (default 0.0.0.0)',
        '  --name <label>   machine name in pairing',
        '  --state <dir>    identity + secret dir (default ~/.vavd)',
        '  --no-announce    skip LAN multicast',
        ''
      ].join('\n')
    )
    return
  }

  const stateDir = argValue('--state', join(homedir(), '.vavd')) ?? join(homedir(), '.vavd')
  const name = argValue('--name') || defaultHostName()
  const identity = loadOrCreateIdentity(stateDir, name)
  const secret = loadOrCreateSecret(stateDir)
  const portRaw = argValue('--port')
  const portParsed = portRaw === undefined ? DAEMON_DEFAULT_PORT : Number(portRaw)
  const port = Number.isFinite(portParsed) ? portParsed : DAEMON_DEFAULT_PORT
  const bind = argValue('--listen', '0.0.0.0') ?? '0.0.0.0'

  const host = createLocalWorkspaceHost({ name: identity.name })
  const server = new DaemonServer({
    host,
    identity,
    secret: () => secret,
    appVersion: process.env.npm_package_version || '0.0.0',
    home: homedir(),
    tmp: tmpdir()
  })

  const bound = await server.listen(port, bind)
  const lans = lanAddresses()
  const pairing = encodeDaemonPairing({
    v: DAEMON_PROTO_VERSION,
    secret,
    machineId: identity.machineId,
    name: identity.name,
    host: lans[0] || '127.0.0.1',
    port: bound,
    addresses: [...lans, '127.0.0.1']
  })

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

  process.stdout.write(`vavd listening on ${bind}:${bound}\n`)
  process.stdout.write(`${pairing}\n`)
  process.stdout.write('Paste that line in VAV → Settings → Allow other devices → Pair.\n')

  const shutdown = (): void => {
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
