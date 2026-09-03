/** Convert `#rrggbb` → 16-bit RGB triplets for AppleScript `choose color`. */
export function parseHexToRgb16(hex?: string): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [
    Math.round((((n >> 16) & 0xff) / 255) * 65535),
    Math.round((((n >> 8) & 0xff) / 255) * 65535),
    Math.round(((n & 0xff) / 255) * 65535)
  ]
}

/** Parse `osascript` `choose color` stdout (`r,g,b` in 0–65535) to `#rrggbb`. */
export function parseOsascriptColorText(stdout: string): string | null {
  const out = stdout.trim()
  if (!out || out === 'false') return null
  const parts = out.split(',')
  if (parts.length !== 3) return null
  const r = Math.round((Number(parts[0]) / 65535) * 255)
  const g = Math.round((Number(parts[1]) / 65535) * 255)
  const b = Math.round((Number(parts[2]) / 65535) * 255)
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
