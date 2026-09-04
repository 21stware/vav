import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnLocalVavd } from '../src/main/daemon/vavdSpawn.ts'

const root = join(__dirname, '..')

export type VavdHandle = {
  pairing: string
  machineId: string
  name: string
  workspace: string
  stop: () => void
}

export type StartVavdOptions = {
  /** Finish VAV turns in the daemon — no provider HTTP (VAV_E2E_STUB_TURN). */
  stubTurn?: boolean
  /** Stream reasoning + a tool card before the stub reply. */
  stubStream?: boolean
  /** Park the stub on Approve/Deny until the client answers. */
  stubApprove?: boolean
}

/**
 * Spawn headless `vavd` with a planted workspace file. Used by the remote
 * daemon e2e so the desktop app pairs against a real process, not a mock.
 */
export async function startVavd(options: StartVavdOptions = {}): Promise<VavdHandle> {
  // Must live under os.tmpdir() — vavd only allows phone-protocol workdir
  // binds inside home / tmp / current / recents. Hardcoding /tmp on macOS
  // plants outside GHA's /var/folders tmp root, so setWorkspace is forbidden.
  const workspace = mkdtempSync(join(tmpdir(), 'vav-e2e-remote-ws-'))
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'remote-only.md'), 'planted by vavd e2e\n')
  mkdirSync(join(workspace, 'remote-pkg'))
  writeFileSync(join(workspace, 'remote-pkg', 'inside.md'), 'nested remote file\n')

  const spawned = await spawnLocalVavd({
    cwd: root,
    name: 'E2E Daemon',
    stubTurn: options.stubTurn,
    stubStream: options.stubStream,
    stubApprove: options.stubApprove
  })

  return {
    pairing: spawned.pairing,
    machineId: spawned.machineId,
    name: spawned.name,
    workspace,
    stop: () => {
      spawned.stop()
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}
