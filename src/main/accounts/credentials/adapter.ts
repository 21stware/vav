import type { CliHostKind } from '../../../shared/cliHost.ts'

export interface HostCredentialSnapshot {
  /** Slot contents as-is (file text or keychain plaintext). */
  payload: string
  medium: 'file' | 'keychain'
  identity: string | null
  expiresAtMs: number | null
  capturedAt: number
}

export interface HostCredentialAdapter {
  host: CliHostKind
  /** false → local switch is not supported; UI falls back to OAuth. */
  swappable: boolean
  capture(): Promise<HostCredentialSnapshot | null>
  restore(snapshot: HostCredentialSnapshot): Promise<void>
  liveIdentity(): Promise<string | null>
}

export function snapshotExpired(snapshot: HostCredentialSnapshot, now = Date.now(), skewMs = 5 * 60_000): boolean {
  if (snapshot.expiresAtMs == null) return false
  return snapshot.expiresAtMs - now <= skewMs
}

export function coerceSnapshot(raw: unknown): HostCredentialSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.payload !== 'string' || !rec.payload) return null
  if (rec.medium !== 'file' && rec.medium !== 'keychain') return null
  return {
    payload: rec.payload,
    medium: rec.medium,
    identity: typeof rec.identity === 'string' && rec.identity.trim() ? rec.identity.trim() : null,
    expiresAtMs: typeof rec.expiresAtMs === 'number' && Number.isFinite(rec.expiresAtMs) ? rec.expiresAtMs : null,
    capturedAt: typeof rec.capturedAt === 'number' && Number.isFinite(rec.capturedAt) ? rec.capturedAt : Date.now()
  }
}
