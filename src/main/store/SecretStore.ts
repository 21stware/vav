import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  coerceSnapshot,
  type HostCredentialSnapshot
} from '../accounts/credentials/adapter.ts'

/**
 * Encrypted secrets via `safeStorage` (macOS Keychain-backed).
 *
 * The primary LLM API key stays at `apikey.bin` for back-compat. Additional
 * named secrets (e.g. Brave Search) live at `secret-<name>.bin`. Nothing is
 * written to conversations.json or settings.json. If OS encryption is
 * unavailable the value is held in memory only for the session.
 *
 * On macOS, *any* safeStorage call (including isEncryptionAvailable) can show
 * a Keychain prompt. Never touch safeStorage until {@link unlock} runs from
 * the onboarding UI — status/needsUnlock must stay pure.
 */
export type SecretName = 'api' | 'braveSearch' | 'cloudflare' | 'supabase'

const ACCOUNT_SECRET_PREFIX = 'secret-account-'
const OAUTH_SNAPSHOT_PREFIX = 'secret-oauth-'

export class SecretStore {
  private readonly memory = new Map<SecretName, string>()
  private readonly accountMemory = new Map<string, string>()
  private readonly oauthSnapshotMemory = new Map<string, HostCredentialSnapshot>()
  /**
   * When false on darwin, disk decrypt is deferred so Keychain is not touched
   * until the user clicks through onboarding. Non-mac always starts unlocked.
   * Marketing snapshots skip the gate so capture scripts can reach the shell.
   */
  private gateOpen = process.platform !== 'darwin' || Boolean(process.env.VAV_SNAPSHOT)

  private pathFor(name: SecretName): string {
    if (name === 'api') return join(app.getPath('userData'), 'apikey.bin')
    return join(app.getPath('userData'), `secret-${name}.bin`)
  }

  /** Marker written after a successful unlock — returning launches skip the tour. */
  private onboardingDonePath(): string {
    return join(app.getPath('userData'), 'keychain-onboarding-done')
  }

  /**
   * True after the user has finished the Keychain gate once (or already has a
   * persisted API key from before we tracked the marker).
   */
  hasCompletedOnboarding(): boolean {
    if (process.platform !== 'darwin') return true
    if (existsSync(this.onboardingDonePath())) return true
    // Migrate older installs: a key file means they already authorized before.
    if (existsSync(this.pathFor('api'))) return true
    return false
  }

  private markOnboardingDone(): void {
    try {
      const file = this.onboardingDonePath()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${Date.now()}\n`)
    } catch (err) {
      console.error('[secret] failed to persist onboarding marker', err)
    }
  }

  /** Whether this session has already warmed Keychain (or does not need to). */
  isUnlocked(): boolean {
    return this.gateOpen
  }

  /**
   * True when this session still needs an unlock before bootstrap.
   * Pure gate check — never calls safeStorage (that would pop Keychain early).
   */
  needsUnlock(): boolean {
    return process.platform === 'darwin' && !this.gateOpen
  }

  /**
   * Status for the renderer gate. Must not call safeStorage while locked;
   * `isEncryptionAvailable` alone can trigger the macOS Keychain sheet.
   */
  status(): {
    unlocked: boolean
    needsUnlock: boolean
    encryptionAvailable: boolean
    hasKeyFile: boolean
    /** When true, renderer should unlock quietly — not replay welcome/privacy. */
    onboardingComplete: boolean
  } {
    let encryptionAvailable = false
    if (this.gateOpen) {
      try {
        encryptionAvailable = safeStorage.isEncryptionAvailable()
      } catch {
        encryptionAvailable = false
      }
    } else if (process.platform === 'darwin') {
      // Assume Keychain will be available; verified only inside unlock().
      encryptionAvailable = true
    }
    return {
      unlocked: this.gateOpen,
      needsUnlock: this.needsUnlock(),
      encryptionAvailable,
      // File presence is fine — existsSync does not touch Keychain.
      hasKeyFile: existsSync(this.pathFor('api')),
      onboardingComplete: this.hasCompletedOnboarding()
    }
  }

  /**
   * First safeStorage touch of the session. May show the OS Keychain dialog,
   * then warm stored secrets into memory. Safe to call more than once.
   */
  unlock(): { ok: true } | { ok: false; error: string } {
    if (this.gateOpen) return { ok: true }
    try {
      if (safeStorage.isEncryptionAvailable()) {
        // Probe encrypt/decrypt — this is what surfaces the Keychain sheet.
        const probe = safeStorage.encryptString('vav-keychain-unlock')
        safeStorage.decryptString(probe)
        // Warm stored secrets so later get() hits memory without re-prompting.
        for (const name of ['api', 'braveSearch', 'cloudflare', 'supabase'] as const) {
          try {
            const file = this.pathFor(name)
            if (!existsSync(file)) continue
            const value = safeStorage.decryptString(readFileSync(file))
            if (value) this.memory.set(name, value)
          } catch {
            // Corrupt or denied — leave that secret empty for this session.
          }
        }
        this.warmAccountSecrets()
        this.warmOAuthSnapshots()
      }
      this.gateOpen = true
      this.markOnboardingDone()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[secret] keychain unlock failed', err)
      return { ok: false, error: message }
    }
  }

  get(name: SecretName = 'api'): string | null {
    if (this.memory.has(name)) return this.memory.get(name) ?? null
    // Before onboarding unlock, never touch Keychain from incidental reads.
    if (!this.gateOpen) return null
    try {
      const file = this.pathFor(name)
      if (!existsSync(file)) return null
      if (!safeStorage.isEncryptionAvailable()) return null
      const value = safeStorage.decryptString(readFileSync(file))
      if (value) this.memory.set(name, value)
      return value
    } catch {
      return null
    }
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
    // Persist requires Keychain; ensure unlock first (no-op if already open).
    if (!this.gateOpen) {
      const result = this.unlock()
      if (!result.ok) {
        this.memory.set(name, trimmed)
        return
      }
    }
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        this.memory.set(name, trimmed)
        return
      }
      const file = this.pathFor(name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, safeStorage.encryptString(trimmed))
      this.memory.set(name, trimmed)
    } catch (err) {
      console.error(`[secret] persist failed (${name})`, err)
      this.memory.set(name, trimmed)
    }
  }

  clear(name: SecretName = 'api'): void {
    this.memory.delete(name)
    try {
      const file = this.pathFor(name)
      if (existsSync(file)) rmSync(file)
    } catch (err) {
      console.error(`[secret] clear failed (${name})`, err)
    }
  }

  /** Masked form for the settings hint line, e.g. "sk-ant-…7f2a". */
  maskedHint(name: SecretName = 'api'): string | null {
    return this.mask(this.get(name))
  }

  getAccountKey(accountId: string): string | null {
    const id = accountId.trim()
    if (!id) return null
    if (this.accountMemory.has(id)) return this.accountMemory.get(id) ?? null
    if (!this.gateOpen) return null
    try {
      const file = this.accountPath(id)
      if (!existsSync(file)) return null
      if (!safeStorage.isEncryptionAvailable()) return null
      const value = safeStorage.decryptString(readFileSync(file))
      if (value) this.accountMemory.set(id, value)
      return value
    } catch {
      return null
    }
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
    if (!this.gateOpen) {
      const result = this.unlock()
      if (!result.ok) {
        this.accountMemory.set(id, trimmed)
        return
      }
    }
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        this.accountMemory.set(id, trimmed)
        return
      }
      const file = this.accountPath(id)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, safeStorage.encryptString(trimmed))
      this.accountMemory.set(id, trimmed)
    } catch (err) {
      console.error(`[secret] persist failed (account ${id})`, err)
      this.accountMemory.set(id, trimmed)
    }
  }

  clearAccountKey(accountId: string): void {
    const id = accountId.trim()
    if (!id) return
    this.accountMemory.delete(id)
    try {
      const file = this.accountPath(id)
      if (existsSync(file)) rmSync(file)
    } catch (err) {
      console.error(`[secret] clear failed (account ${id})`, err)
    }
  }

  maskedAccountHint(accountId: string): string | null {
    return this.mask(this.getAccountKey(accountId))
  }

  setOAuthSnapshot(accountId: string, snapshot: HostCredentialSnapshot): void {
    const id = accountId.trim()
    if (!id) return
    this.oauthSnapshotMemory.set(id, snapshot)
    if (!this.gateOpen) {
      const result = this.unlock()
      if (!result.ok) return
    }
    try {
      if (!safeStorage.isEncryptionAvailable()) return
      const file = this.oauthSnapshotPath(id)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, safeStorage.encryptString(JSON.stringify(snapshot)))
    } catch (err) {
      console.error(`[secret] persist failed (oauth ${id})`, err)
    }
  }

  getOAuthSnapshot(accountId: string): HostCredentialSnapshot | null {
    const id = accountId.trim()
    if (!id) return null
    const cached = this.oauthSnapshotMemory.get(id)
    if (cached) return cached
    if (!this.gateOpen) return null
    try {
      const file = this.oauthSnapshotPath(id)
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
      const snap = coerceSnapshot(safeJson(safeStorage.decryptString(readFileSync(file))))
      if (snap) this.oauthSnapshotMemory.set(id, snap)
      return snap
    } catch {
      return null
    }
  }

  clearOAuthSnapshot(accountId: string): void {
    const id = accountId.trim()
    if (!id) return
    this.oauthSnapshotMemory.delete(id)
    try {
      const file = this.oauthSnapshotPath(id)
      if (existsSync(file)) rmSync(file)
    } catch (err) {
      console.error(`[secret] clear failed (oauth ${id})`, err)
    }
  }

  private accountPath(accountId: string): string {
    const safe = accountId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(app.getPath('userData'), `${ACCOUNT_SECRET_PREFIX}${safe}.bin`)
  }

  private oauthSnapshotPath(accountId: string): string {
    const safe = accountId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(app.getPath('userData'), `${OAUTH_SNAPSHOT_PREFIX}${safe}.bin`)
  }

  private warmAccountSecrets(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir) || !safeStorage.isEncryptionAvailable()) return
      for (const name of readdirSync(dir)) {
        if (!name.startsWith(ACCOUNT_SECRET_PREFIX) || !name.endsWith('.bin')) continue
        const id = name.slice(ACCOUNT_SECRET_PREFIX.length, -4)
        if (!id || this.accountMemory.has(id)) continue
        try {
          const value = safeStorage.decryptString(readFileSync(join(dir, name)))
          if (value) this.accountMemory.set(id, value)
        } catch {
          // Corrupt or denied — leave empty for this session.
        }
      }
    } catch {
      // userData unreadable
    }
  }

  private warmOAuthSnapshots(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir) || !safeStorage.isEncryptionAvailable()) return
      for (const name of readdirSync(dir)) {
        if (!name.startsWith(OAUTH_SNAPSHOT_PREFIX) || !name.endsWith('.bin')) continue
        const id = name.slice(OAUTH_SNAPSHOT_PREFIX.length, -4)
        if (!id || this.oauthSnapshotMemory.has(id)) continue
        try {
          const snap = coerceSnapshot(safeJson(safeStorage.decryptString(readFileSync(join(dir, name)))))
          if (snap) this.oauthSnapshotMemory.set(id, snap)
        } catch {
          // Corrupt or denied — leave empty for this session.
        }
      }
    } catch {
      // userData unreadable
    }
  }

  private mask(key: string | null): string | null {
    if (!key) return null
    if (key.length <= 10) return '••••'
    return `${key.slice(0, 7)}…${key.slice(-4)}`
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
