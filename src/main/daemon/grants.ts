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
  /** Host disconnected this grant; cleared on the next successful hello. */
  kicked?: boolean
}

export type GrantStore = {
  list(): PairGrant[]
  findById(id: string): PairGrant | null
  findBySecret(secret: string): PairGrant | null
  findByClientId(clientId: string): PairGrant | null
  issue(input: { clientId: string; name: string }): PairGrant
  touch(id: string, name?: string): void
  markKicked(id: string): void
  remove(id: string): PairGrant | null
  /**
   * True when `id` was a grant this host removed (unpair / pair.leave). Lets a
   * hello carrying a dead grant id get an explicit `revoked` instead of the
   * generic `pairing rejected`, so an offline controller stops redialing.
   */
  isRevoked(id: string): boolean
  /** Removed grant ids, oldest first (persisted with the grants). */
  revokedIds(): string[]
}

/** Tombstones kept per store; old ones fall off so the file stays small. */
const REVOKED_CAP = 256

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
    lastSeen,
    kicked: raw.kicked === true
  }
}

export function createMemoryGrantStore(seed: PairGrant[] = [], revokedSeed: string[] = []): GrantStore {
  const rows = new Map<string, PairGrant>()
  for (const grant of seed) rows.set(grant.id, { ...grant })
  const revoked = new Set<string>()
  for (const id of revokedSeed) if (id && !rows.has(id)) revoked.add(id)
  const tombstone = (id: string): void => {
    revoked.delete(id)
    revoked.add(id)
    while (revoked.size > REVOKED_CAP) {
      const oldest = revoked.values().next().value
      if (oldest === undefined) break
      revoked.delete(oldest)
    }
  }
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
      const now = Date.now()
      if (existing) {
        // Same controller pairing again (or racing LAN + tunnel): hand back its
        // grant. Minting a new one silently invalidated whichever connection
        // won the race, and the next reconnect then failed "pairing rejected".
        existing.name = name
        existing.lastSeen = now
        existing.kicked = false
        return existing
      }
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
      grant.kicked = false
      if (name?.trim()) grant.name = name.trim()
    },
    markKicked(id) {
      const grant = rows.get(id)
      if (!grant) return
      grant.kicked = true
      grant.lastSeen = Date.now()
    },
    remove(id) {
      const grant = rows.get(id) ?? null
      if (grant) {
        rows.delete(id)
        tombstone(id)
      }
      return grant
    },
    isRevoked(id) {
      return Boolean(id) && revoked.has(id)
    },
    revokedIds() {
      return [...revoked]
    }
  }
}

export function createFileGrantStore(dir: string): GrantStore {
  const file = join(dir, 'grants.json')
  const loaded = loadGrantsFile(file)
  const memory = createMemoryGrantStore(loaded.grants, loaded.revoked)
  const persist = (): void => {
    mkdirSync(dirname(file), { recursive: true })
    writePrivateJson(file, { grants: memory.list(), revoked: memory.revokedIds() })
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
    markKicked(id) {
      memory.markKicked(id)
      persist()
    },
    remove(id) {
      const grant = memory.remove(id)
      if (grant) persist()
      return grant
    },
    isRevoked: (id) => memory.isRevoked(id),
    revokedIds: () => memory.revokedIds()
  }
}

function loadGrantsFile(file: string): { grants: PairGrant[]; revoked: string[] } {
  try {
    if (!existsSync(file)) return { grants: [], revoked: [] }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { grants?: unknown; revoked?: unknown }
    const grants = Array.isArray(raw.grants)
      ? raw.grants.map(asGrant).filter((row): row is PairGrant => row !== null)
      : []
    const revoked = Array.isArray(raw.revoked)
      ? raw.revoked.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    return { grants, revoked }
  } catch {
    return { grants: [], revoked: [] }
  }
}

export function incomingFromGrants(
  grants: PairGrant[],
  onlineIds: ReadonlySet<string>,
  extras: IncomingController[] = []
): IncomingController[] {
  const live = grants.map((grant) => {
    const online = onlineIds.has(grant.id)
    const state = online ? 'online' : grant.kicked ? 'kicked' : 'offline'
    return {
      id: grant.id,
      name: grant.name,
      clientId: grant.clientId,
      state,
      online,
      lastSeen: grant.lastSeen,
      issuedAt: grant.issuedAt
    } satisfies IncomingController
  })
  const seen = new Set(live.map((row) => row.id))
  const extra = extras.filter((row) => !seen.has(row.id))
  return [...extra, ...live]
}

export function isPairRevokedMessage(message: string): boolean {
  return /pairing revoked|\brevoked\b/i.test(message)
}

export function isPairAuthMessage(message: string): boolean {
  return /pairing rejected|\bauth\b|pairing revoked|\brevoked\b/i.test(message)
}
