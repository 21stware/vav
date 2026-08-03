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
 */
export type SecretName = 'api' | 'braveSearch'

export class SecretStore {
  private readonly memory = new Map<SecretName, string>()

  private pathFor(name: SecretName): string {
    if (name === 'api') return join(app.getPath('userData'), 'apikey.bin')
    return join(app.getPath('userData'), `secret-${name}.bin`)
  }

  get(name: SecretName = 'api'): string | null {
    if (this.memory.has(name)) return this.memory.get(name) ?? null
    try {
      const file = this.pathFor(name)
      if (!existsSync(file)) return null
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(readFileSync(file))
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
    if (!safeStorage.isEncryptionAvailable()) {
      this.memory.set(name, trimmed)
      return
    }
    try {
      const file = this.pathFor(name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, safeStorage.encryptString(trimmed))
      this.memory.delete(name)
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
