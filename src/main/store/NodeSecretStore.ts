/**
 * File-backed secrets for headless `vavd` (mode 0600). Same method surface
 * AgentRuntime / resolveVavCredentials need from Electron SecretStore.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SecretName, SecretStore } from './SecretStore.ts'

const ACCOUNT_SECRET_PREFIX = 'secret-account-'

export class NodeSecretStore {
  private readonly memory = new Map<SecretName, string>()
  private readonly accountMemory = new Map<string, string>()
  private readonly userDataDir: string

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
  }

  private pathFor(name: SecretName): string {
    if (name === 'api') return join(this.userDataDir, 'apikey')
    return join(this.userDataDir, `secret-${name}`)
  }

  private accountPath(accountId: string): string {
    const safe = accountId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.userDataDir, `${ACCOUNT_SECRET_PREFIX}${safe}`)
  }

  load(): void {
    for (const name of ['api', 'braveSearch', 'tinyfish', 'cloudflare', 'supabase'] as const) {
      const value = this.readFile(this.pathFor(name))
      if (value) this.memory.set(name, value)
    }
  }

  get(name: SecretName = 'api'): string | null {
    if (this.memory.has(name)) return this.memory.get(name) ?? null
    const value = this.readFile(this.pathFor(name))
    if (value) this.memory.set(name, value)
    return value
  }

  has(name: SecretName = 'api'): boolean {
    const key = this.get(name)
    return !!key && key.length > 0
  }

  set(key: string, name: SecretName = 'api'): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.clear(name)
      return
    }
    this.writeFile(this.pathFor(name), trimmed)
    this.memory.set(name, trimmed)
  }

  clear(name: SecretName = 'api'): void {
    this.memory.delete(name)
    this.removeFile(this.pathFor(name))
  }

  getAccountKey(accountId: string): string | null {
    const id = accountId.trim()
    if (!id) return null
    if (this.accountMemory.has(id)) return this.accountMemory.get(id) ?? null
    const value = this.readFile(this.accountPath(id))
    if (value) this.accountMemory.set(id, value)
    return value
  }

  hasAccountKey(accountId: string): boolean {
    const key = this.getAccountKey(accountId)
    return !!key && key.length > 0
  }

  setAccountKey(accountId: string, key: string): void {
    const id = accountId.trim()
    if (!id) return
    const trimmed = key.trim()
    if (!trimmed) {
      this.clearAccountKey(id)
      return
    }
    this.writeFile(this.accountPath(id), trimmed)
    this.accountMemory.set(id, trimmed)
  }

  clearAccountKey(accountId: string): void {
    const id = accountId.trim()
    if (!id) return
    this.accountMemory.delete(id)
    this.removeFile(this.accountPath(id))
  }

  /** Enough of SecretStore for AgentRuntime + accounts. */
  asSecretStore(): SecretStore {
    return this as unknown as SecretStore
  }

  private readFile(file: string): string | null {
    try {
      if (!existsSync(file)) return null
      const value = readFileSync(file, 'utf8').trim()
      return value || null
    } catch {
      return null
    }
  }

  private writeFile(file: string, value: string): void {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 })
  }

  private removeFile(file: string): void {
    try {
      if (existsSync(file)) rmSync(file)
    } catch {
      /* ignore */
    }
  }
}
