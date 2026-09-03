/**
 * Per-controller pairing grants. The printed URI / QR is an offer that can
 * mint a grant; later hellos authenticate with the grant secret so one
 * controller can be revoked without rotating everyone.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IncomingController } from '../../shared/daemonProtocol.ts'
import { secretsMatch } from './jsonLines.ts'
import { writePrivateJson } from './identity.ts'

export type { IncomingController }

export type PairGrant = {
  id: string
  secret: string
  clientId: string
  name: string
  issuedAt: number
  lastSeen: number
}

export type GrantStore = {
  list(): PairGrant[]
  findById(id: string): PairGrant | null
  findBySecret(secret: string): PairGrant | null
  findByClientId(clientId: string): PairGrant | null
  issue(input: { clientId: string; name: string }): PairGrant
  touch(id: string, name?: string): void
  remove(id: string): PairGrant | null
}

function mintSecret(): string {
  return randomBytes(24).toString('base64url')
}

function asGrant(value: unknown): PairGrant | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.secret !== 'string' || raw.secret.length < 16) return null
  if (typeof raw.clientId !== 'string' || !raw.clientId.trim()) return null
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'unknown'
  const issuedAt = typeof raw.issuedAt === 'number' && Number.isFinite(raw.issuedAt) ? raw.issuedAt : Date.now()
  const lastSeen = typeof raw.lastSeen === 'number' && Number.isFinite(raw.lastSeen) ? raw.lastSeen : issuedAt
  return {
    id: raw.id.trim(),
    secret: raw.secret,
    clientId: raw.clientId.trim(),
    name,
    issuedAt,
    lastSeen
  }
}

export function createMemoryGrantStore(seed: PairGrant[] = []): GrantStore {
  const rows = new Map<string, PairGrant>()
  for (const grant of seed) rows.set(grant.id, { ...grant })
  return {
    list() {
      return [...rows.values()].sort((a, b) => b.lastSeen - a.lastSeen)
    },
    findById(id) {
      return rows.get(id) ?? null
    },
    findBySecret(secret) {
      for (const grant of rows.values()) {
        if (secretsMatch(grant.secret, secret)) return grant
      }
      return null
    },
    findByClientId(clientId) {
      const id = clientId.trim()
      if (!id) return null
      for (const grant of rows.values()) {
        if (grant.clientId === id) return grant
      }
      return null
    },
    issue(input) {
      const clientId = input.clientId.trim() || randomUUID()
      const name = input.name.trim() || 'unknown'
      const existing = this.findByClientId(clientId)
      if (existing) rows.delete(existing.id)
      const now = Date.now()
      const grant: PairGrant = {
        id: randomUUID(),
        secret: mintSecret(),
        clientId,
        name,
        issuedAt: now,
        lastSeen: now
      }
      rows.set(grant.id, grant)
      return grant
    },
    touch(id, name) {
      const grant = rows.get(id)
      if (!grant) return
      grant.lastSeen = Date.now()
      if (name?.trim()) grant.name = name.trim()
    },
    remove(id) {
      const grant = rows.get(id) ?? null
      if (grant) rows.delete(id)
      return grant
    }
  }
}

export function createFileGrantStore(dir: string): GrantStore {
  const file = join(dir, 'grants.json')
  const memory = createMemoryGrantStore(loadGrantsFile(file))
  const persist = (): void => {
    mkdirSync(dirname(file), { recursive: true })
    writePrivateJson(file, { grants: memory.list() })
  }
  return {
    list: () => memory.list(),
    findById: (id) => memory.findById(id),
    findBySecret: (secret) => memory.findBySecret(secret),
    findByClientId: (id) => memory.findByClientId(id),
    issue(input) {
      const grant = memory.issue(input)
      persist()
      return grant
    },
    touch(id, name) {
      memory.touch(id, name)
      persist()
    },
    remove(id) {
      const grant = memory.remove(id)
      if (grant) persist()
      return grant
    }
  }
}

function loadGrantsFile(file: string): PairGrant[] {
  try {
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { grants?: unknown }
    if (!Array.isArray(raw.grants)) return []
    return raw.grants.map(asGrant).filter((row): row is PairGrant => row !== null)
  } catch {
    return []
  }
}

export function incomingFromGrants(
  grants: PairGrant[],
  onlineIds: ReadonlySet<string>
): IncomingController[] {
  return grants.map((grant) => ({
    id: grant.id,
    name: grant.name,
    clientId: grant.clientId,
    online: onlineIds.has(grant.id),
    lastSeen: grant.lastSeen,
    issuedAt: grant.issuedAt
  }))
}

export function isPairRevokedMessage(message: string): boolean {
  return /pairing revoked|\brevoked\b/i.test(message)
}

export function isPairAuthMessage(message: string): boolean {
  return /pairing rejected|\bauth\b|pairing revoked|\brevoked\b/i.test(message)
}
