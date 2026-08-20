export type OscColorQuerySlot = 10 | 11

export function cssColorToOscRgb(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed)?.[1]
  if (hex) {
    const expanded =
      hex.length === 3 ? hex.split('').map((c) => `${c}${c}`).join('') : hex
    return `rgb:${hexByteToWord(expanded.slice(0, 2))}/${hexByteToWord(expanded.slice(2, 4))}/${hexByteToWord(expanded.slice(4, 6))}`
  }
  return null
}

function hexByteToWord(byte: string): string {
  return byte.repeat(2)
}

export function oscColorQueryReply(slot: OscColorQuerySlot, cssColor: string | undefined): string | null {
  const rgb = cssColorToOscRgb(cssColor)
  if (!rgb) return null
  return `\x1b]${slot};${rgb}\x1b\\`
}

export const KITTY_KEYBOARD_QUERY_REPLY = '\x1b[?1u'
