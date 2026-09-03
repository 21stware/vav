import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'

export type DaemonIdentity = {
  machineId: string
  name: string
}

/** Pairing secrets and host records must not be world-readable. */
export const SECRET_FILE_MODE = 0o600

export function writePrivateJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: SECRET_FILE_MODE })
  try {
    chmodSync(file, SECRET_FILE_MODE)
  } catch {
    /* windows / chmod-less fs */
  }
}

export function defaultHostName(): string {
  try {
    const host = hostname().trim()
    if (host) return host
  } catch {
    /* ignore */
  }
  try {
    const user = userInfo().username?.trim()
    if (user) return `${user}'s machine`
  } catch {
    /* ignore */
  }
  return 'VAV daemon'
}

export function loadOrCreateIdentity(dir: string, name?: string): DaemonIdentity {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'identity.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { machineId?: unknown; name?: unknown }
      if (typeof raw.machineId === 'string' && raw.machineId.trim()) {
        const resolved: DaemonIdentity = {
          machineId: raw.machineId.trim(),
          name: (typeof raw.name === 'string' && raw.name.trim()) || name || defaultHostName()
        }
        if (name && name.trim() && resolved.name !== name.trim()) {
          resolved.name = name.trim()
          writePrivateJson(file, resolved)
        }
        return resolved
      }
    }
  } catch {
    /* rotate below */
  }
  const identity: DaemonIdentity = {
    machineId: randomUUID(),
    name: name?.trim() || defaultHostName()
  }
  writePrivateJson(file, identity)
  return identity
}

export function loadOrCreateSecret(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'secret.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { secret?: unknown }
      if (typeof raw.secret === 'string' && raw.secret.length >= 16) return raw.secret
    }
  } catch {
    /* rotate */
  }
  const secret = randomBytes(24).toString('base64url')
  writePrivateJson(file, { secret })
  return secret
}

export function persistSecret(dir: string, secret: string): void {
  mkdirSync(dir, { recursive: true })
  writePrivateJson(join(dir, 'secret.json'), { secret })
}
