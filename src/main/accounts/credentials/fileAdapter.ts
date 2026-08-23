import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CliHostKind } from '../../../shared/cliHost.ts'
import type { HostCredentialAdapter, HostCredentialSnapshot } from './adapter.ts'
import { parseFileSnapshotMeta } from './parseFileSnapshot.ts'

export function makeFileAdapter(input: {
  host: CliHostKind
  path: () => string
}): HostCredentialAdapter {
  const read = (): string | null => {
    try {
      return readFileSync(input.path(), 'utf8')
    } catch {
      return null
    }
  }
  return {
    host: input.host,
    swappable: true,
    async capture(): Promise<HostCredentialSnapshot | null> {
      const payload = read()
      if (!payload?.trim()) return null
      const meta = parseFileSnapshotMeta(input.host, payload)
      return {
        payload,
        medium: 'file',
        identity: meta.identity,
        expiresAtMs: meta.expiresAtMs,
        capturedAt: Date.now()
      }
    },
    async restore(snapshot: HostCredentialSnapshot): Promise<void> {
      if (snapshot.medium !== 'file') {
        throw new Error(`cannot restore ${snapshot.medium} snapshot into a file slot`)
      }
      const dest = input.path()
      mkdirSync(dirname(dest), { recursive: true })
      const tmp = `${dest}.vav.tmp`
      writeFileSync(tmp, snapshot.payload, { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(tmp, 0o600)
      } catch {
        // Windows / some FS ignore mode
      }
      renameSync(tmp, dest)
      try {
        chmodSync(dest, 0o600)
      } catch {
        // ignore
      }
    },
    async liveIdentity(): Promise<string | null> {
      const payload = read()
      if (!payload) return null
      return parseFileSnapshotMeta(input.host, payload).identity
    }
  }
}
