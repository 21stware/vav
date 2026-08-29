import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'

export type DaemonIdentity = {
  machineId: string
  name: string
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
          writeFileSync(file, JSON.stringify(resolved, null, 2))
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
  writeFileSync(file, JSON.stringify(identity, null, 2))
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
  writeFileSync(file, JSON.stringify({ secret }, null, 2))
  return secret
}

export function persistSecret(dir: string, secret: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'secret.json'), JSON.stringify({ secret }, null, 2))
}
