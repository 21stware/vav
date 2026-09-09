import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnLocalVavServer } from '../src/main/daemon/vavServerSpawn.ts'

const root = join(__dirname, '..')

export type VavServerHandle = {
  pairing: string
  machineId: string
  name: string
  workspace: string
  webOrigin?: string
  stop: () => void
}

export type StartVavServerOptions = {
  /** Finish VAV turns in the daemon — no provider HTTP (VAV_E2E_STUB_TURN). */
  stubTurn?: boolean
  /** Stream reasoning + a tool card before the stub reply. */
  stubStream?: boolean
  /** Park the stub on Approve/Deny until the client answers. */
  stubApprove?: boolean
  /** Serve the loopback phone-ui / Chrome discover bridge. */
  web?: boolean
  extraEnv?: NodeJS.ProcessEnv
}

/**
 * Spawn headless `vav-server` with a planted workspace file. Used by the remote
 * daemon e2e so the desktop app pairs against a real process, not a mock.
 */
export async function startVavServer(options: StartVavServerOptions = {}): Promise<VavServerHandle> {
  // Must live under os.tmpdir() — vav-server only allows phone-protocol workdir
  // binds inside home / tmp / current / recents. Hardcoding /tmp on macOS
  // plants outside GHA's /var/folders tmp root, so setWorkspace is forbidden.
  const workspace = mkdtempSync(join(tmpdir(), 'vav-e2e-remote-ws-'))
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'remote-only.md'), 'planted by vav-server e2e\n')
  mkdirSync(join(workspace, 'remote-pkg'))
  writeFileSync(join(workspace, 'remote-pkg', 'inside.md'), 'nested remote file\n')

  const spawned = await spawnLocalVavServer({
    cwd: root,
    name: 'E2E Daemon',
    stubTurn: options.stubTurn,
    stubStream: options.stubStream,
    stubApprove: options.stubApprove,
    extraEnv: options.extraEnv,
    noWeb: options.web ? false : true
  })

  return {
    pairing: spawned.pairing,
    machineId: spawned.machineId,
    name: spawned.name,
    workspace,
    webOrigin: spawned.webOrigin,
    stop: () => {
      spawned.stop()
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}
