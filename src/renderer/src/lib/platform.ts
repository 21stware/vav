import { isMac, type Platform } from '@shared/platform'

/**
 * `window.vav` is installed by the preload script before any renderer module
 * runs, so this is safe to read at module scope. The fallback only matters in
 * a bare browser tab (vite's `index.html` opened by hand).
 */
export const PLATFORM: Platform = window.vav?.platform ?? 'darwin'
export const IS_MAC = isMac(PLATFORM)

/** What "reveal in the file manager" is called where the user is standing. */
export const FILE_MANAGER = IS_MAC ? 'Finder' : PLATFORM === 'win32' ? '文件资源管理器' : '文件管理器'

const WINDOWS_NAMES: Record<string, string> = {
  '⌘': 'Ctrl',
  '⌃': 'Ctrl',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '↵': 'Enter'
}

/**
 * Respells a macOS glyph chord for the keyboard actually attached.
 *
 * Shortcuts are written once, in the form they take on the Mac the app was
 * designed on (`⌘⇧O`), and read as `Ctrl+Shift+O` on Windows. Keeping the
 * glyphs as the source form means a shortcut is declared in one place even
 * though it is displayed in two.
 */
export function keys(chord: string): string {
  if (IS_MAC) return chord

  const parts: string[] = []
  let key = ''
  for (const character of chord) {
    const name = WINDOWS_NAMES[character]
    // A modifier glyph only reads as a modifier while it still leads the chord;
    // `⌘↵` ends on ↵, which is the key, not a fourth modifier.
    if (name && !key) parts.push(name)
    else key += character
  }
  if (key) parts.push(key)
  return [...new Set(parts)].join('+')
}
