/**
 * Per-conversation secrets for `request_for_secret`.
 *
 * Values live here (and in the session process env) — never in conversation
 * shards, tool cards, or model context. Names are the only thing the agent sees.
 *
 * Desktop persists through Keychain-backed SecretStore blobs. A leftover
 * `session-secrets/*.json` file is migrated on first read, then removed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeEnvName, normalizeSecretValues } from '../../shared/sessionSecrets.ts'

export type SessionSecretPersist = {
  read(id: string): string | null
  write(id: string, json: string): void
  remove(id: string): void
}

export class SessionSecretStore {
  private readonly memory = new Map<string, Record<string, string>>()
  private readonly dir: string | null
  private readonly persist: SessionSecretPersist | null
  private readonly listeners: Array<(conversationId: string, names: string[]) => void> = []

  constructor(opts?: { dir?: string; persist?: SessionSecretPersist }) {
    this.dir = opts?.dir?.trim() || null
    this.persist = opts?.persist ?? null
  }

  onChanged(listener: (conversationId: string, names: string[]) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  getEnv(conversationId: string): Record<string, string> {
    const id = conversationId.trim()
    if (!id) return {}
    const cached = this.memory.get(id)
    if (cached) return { ...cached }
    const loaded = this.readPersisted(id)
    if (loaded) {
      this.memory.set(id, loaded)
      return { ...loaded }
    }
    return {}
  }

  listNames(conversationId: string): string[] {
    return Object.keys(this.getEnv(conversationId)).sort()
  }

  setMany(conversationId: string, values: Record<string, string>): string[] {
    const id = conversationId.trim()
    if (!id) return []
    const next = { ...this.getEnv(id), ...normalizeSecretValues(values) }
    const names = Object.keys(next)
    if (names.length === 0) return []
    this.memory.set(id, next)
    this.writePersisted(id, next)
    this.emitChanged(id)
    return names.sort()
  }

  remove(conversationId: string, name: string): boolean {
    const id = conversationId.trim()
    const envName = normalizeEnvName(name)
    if (!id || !envName) return false
    const current = this.getEnv(id)
    if (!(envName in current)) return false
    const next = { ...current }
    delete next[envName]
    if (Object.keys(next).length === 0) {
      this.clear(id)
      return true
    }
    this.memory.set(id, next)
    this.writePersisted(id, next)
    this.emitChanged(id)
    return true
  }

  clear(conversationId: string): void {
    const id = conversationId.trim()
    if (!id) return
    const had = this.memory.has(id) || this.hasPersisted(id)
    this.memory.delete(id)
    this.removePersisted(id)
    if (had) this.emitChanged(id)
  }

  private emitChanged(id: string): void {
    const names = this.listNames(id)
    for (const listener of this.listeners) {
      try {
        listener(id, names)
      } catch (err) {
        console.error('[session-secret] onChanged listener failed', err)
      }
    }
  }

  private readPersisted(id: string): Record<string, string> | null {
    const fromAdapter = this.parseMap(this.persist?.read(id) ?? null)
    if (fromAdapter) return fromAdapter
    const fromFile = this.readDisk(id)
    if (fromFile && this.persist) {
      this.writePersisted(id, fromFile)
      this.removeDisk(id)
    }
    return fromFile
  }

  private hasPersisted(id: string): boolean {
    if (this.persist?.read(id)) return true
    const file = this.fileFor(id)
    return Boolean(file && existsSync(file))
  }

  private writePersisted(id: string, values: Record<string, string>): void {
    const json = JSON.stringify(values)
    if (this.persist) {
      try {
        this.persist.write(id, json)
        this.removeDisk(id)
        return
      } catch (err) {
        console.error('[session-secret] persist adapter failed', err)
      }
    }
    this.writeDisk(id, values)
  }

  private removePersisted(id: string): void {
    try {
      this.persist?.remove(id)
    } catch (err) {
      console.error('[session-secret] persist adapter clear failed', err)
    }
    this.removeDisk(id)
  }

  private parseMap(raw: string | null): Record<string, string> | null {
    if (!raw) return null
    try {
      const values = normalizeSecretValues(JSON.parse(raw) as unknown)
      return Object.keys(values).length ? values : null
    } catch {
      return null
    }
  }

  private readDisk(id: string): Record<string, string> | null {
    const file = this.fileFor(id)
    if (!file || !existsSync(file)) return null
    try {
      return this.parseMap(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  private writeDisk(id: string, values: Record<string, string>): void {
    const file = this.fileFor(id)
    if (!file) return
    try {
      mkdirSync(this.dir!, { recursive: true, mode: 0o700 })
      writeFileSync(file, JSON.stringify(values), { mode: 0o600 })
    } catch (err) {
      console.error('[session-secret] persist failed', err)
    }
  }

  private removeDisk(id: string): void {
    const file = this.fileFor(id)
    if (!file || !existsSync(file)) return
    try {
      rmSync(file)
    } catch (err) {
      console.error('[session-secret] clear failed', err)
    }
  }

  private fileFor(id: string): string | null {
    if (!this.dir) return null
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (!safe) return null
    return join(this.dir, `${safe}.json`)
  }
}
