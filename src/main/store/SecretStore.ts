import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * The API key, and nothing else.
 *
 * `safeStorage` encrypts with a key held in the macOS Keychain, which keeps the
 * product invariant from README §6: the key never lands in conversations.json
 * and never syncs. If OS encryption is unavailable the key is held in memory
 * only for the session rather than written as plaintext.
 */
export class SecretStore {
  private readonly file = join(app.getPath('userData'), 'apikey.bin')
  private memoryOnly: string | null = null

  get(): string | null {
    if (this.memoryOnly !== null) return this.memoryOnly
    try {
      if (!existsSync(this.file)) return null
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(readFileSync(this.file))
    } catch {
      return null
    }
  }

  has(): boolean {
    const key = this.get()
    return !!key && key.length > 0
  }

  set(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.clear()
      return
    }
    if (!safeStorage.isEncryptionAvailable()) {
      this.memoryOnly = trimmed
      return
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, safeStorage.encryptString(trimmed))
      this.memoryOnly = null
    } catch (err) {
      console.error('[secret] persist failed', err)
      this.memoryOnly = trimmed
    }
  }

  clear(): void {
    this.memoryOnly = null
    try {
      if (existsSync(this.file)) rmSync(this.file)
    } catch (err) {
      console.error('[secret] clear failed', err)
    }
  }

  /** Masked form for the settings hint line, e.g. "sk-ant-…7f2a". */
  maskedHint(): string | null {
    const key = this.get()
    if (!key) return null
    if (key.length <= 10) return '••••'
    return `${key.slice(0, 7)}…${key.slice(-4)}`
  }
}
