import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

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
export type SecretName = 'api' | 'braveSearch' | 'cloudflare'

export class SecretStore {
  private readonly memory = new Map<SecretName, string>()
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
        for (const name of ['api', 'braveSearch', 'cloudflare'] as const) {
          try {
            const file = this.pathFor(name)
            if (!existsSync(file)) continue
            const value = safeStorage.decryptString(readFileSync(file))
            if (value) this.memory.set(name, value)
          } catch {
            // Corrupt or denied — leave that secret empty for this session.
          }
        }
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
    const key = this.get(name)
    if (!key) return null
    if (key.length <= 10) return '••••'
    return `${key.slice(0, 7)}…${key.slice(-4)}`
  }
}
