import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { DbPasswordVault } from './DbConnectionStore.ts'

export type DbSecretCrypt = {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(buf: Buffer): string
}

/** Electron account-secret filename for `db:<connectionId>`. */
export function dbAccountSecretFileName(connectionId: string): string {
  const safe = `db:${connectionId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `secret-account-${safe}.bin`
}

/** Prod / dev Electron userData siblings share one parent folder. */
export function siblingUserDataDirs(userData: string): string[] {
  const parent = dirname(userData)
  const names = new Set([basename(userData), 'vav', 'vav-dev'])
  return [...names].map((name) => join(parent, name))
}

/**
 * Connections live in the shared vav-server state dir; Electron secrets live
 * per userData (vav vs vav-dev). Read both, and keep a copy next to
 * connections.json so the next client can find it.
 */
export function createChainedDbPasswordVault(opts: {
  stateDir: string
  primary: DbPasswordVault
  userData: string
  crypt: DbSecretCrypt
  unlock?: () => void
}): DbPasswordVault {
  const secretDir = join(opts.stateDir, 'db-connections', 'secrets')
  const stateFile = (id: string): string =>
    join(secretDir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`)

  const decryptFile = (file: string): string | null => {
    if (!existsSync(file) || !opts.crypt.available()) return null
    try {
      const value = opts.crypt.decrypt(readFileSync(file))
      return value.trim() ? value : null
    } catch {
      return null
    }
  }

  const persistState = (id: string, password: string): void => {
    if (!opts.crypt.available()) return
    try {
      mkdirSync(secretDir, { recursive: true })
      writeFileSync(stateFile(id), opts.crypt.encrypt(password))
    } catch {
      /* primary already holds it */
    }
  }

  return {
    get(id) {
      opts.unlock?.()
      const fromPrimary = opts.primary.get(id)
      if (fromPrimary) {
        persistState(id, fromPrimary)
        return fromPrimary
      }
      const fromState = decryptFile(stateFile(id))
      if (fromState) {
        opts.primary.set(id, fromState)
        return fromState
      }
      const fileName = dbAccountSecretFileName(id)
      for (const dir of siblingUserDataDirs(opts.userData)) {
        const found = decryptFile(join(dir, fileName))
        if (!found) continue
        opts.primary.set(id, found)
        persistState(id, found)
        return found
      }
      return null
    },
    set(id, password) {
      opts.primary.set(id, password)
      persistState(id, password)
    },
    clear(id) {
      opts.primary.clear(id)
      try {
        if (existsSync(stateFile(id))) rmSync(stateFile(id))
      } catch {
        /* ignore */
      }
    }
  }
}
