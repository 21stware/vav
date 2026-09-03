/** Fallback when the OS cannot report an accent (Linux, old macOS, errors). */
export const FALLBACK_SYSTEM_ACCENT = '#007aff'

/**
 * Normalize any Electron accent string to `#rrggbb`.
 * `systemPreferences.getAccentColor` returns `rrggbbaa` (no hash).
 * `getColor` / event payloads may be `#rrggbbaa` or `#rrggbb`.
 */
export function normalizeAccentHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(cleaned)) return null
  return `#${cleaned.slice(0, 6)}`
}
