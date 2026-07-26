/**
 * The handful of places where macOS and Windows genuinely disagree.
 *
 * These are pure functions of a platform string rather than reads of
 * `process.platform`, because the renderer has no `process` — it is told which
 * platform it is running on once, at bootstrap, and asks the same questions.
 */

import type { AppSettings, ShellKind } from './types'

export type Platform = 'darwin' | 'win32' | 'linux'

export function isMac(platform: Platform): boolean {
  return platform === 'darwin'
}

export function isWindows(platform: Platform): boolean {
  return platform === 'win32'
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

export interface ShellOption {
  value: ShellKind
  label: string
  /** Shown under the picker, so the user can see what will actually run. */
  hint: string
}

const POSIX_SHELLS: ShellOption[] = [
  { value: 'zsh', label: 'zsh', hint: '/bin/zsh' },
  { value: 'bash', label: 'bash', hint: '/bin/bash' },
  { value: 'fish', label: 'fish', hint: '/opt/homebrew/bin/fish' }
]

const WINDOWS_SHELLS: ShellOption[] = [
  { value: 'powershell', label: 'PowerShell', hint: 'powershell.exe' }
]

export function shellsFor(platform: Platform): ShellOption[] {
  return isWindows(platform) ? WINDOWS_SHELLS : POSIX_SHELLS
}

export function defaultShell(platform: Platform): ShellKind {
  return isWindows(platform) ? 'powershell' : 'zsh'
}

/** Settings carried over from another machine can name a shell that cannot exist here. */
export function coerceShell(platform: Platform, shell: ShellKind): ShellKind {
  return shellsFor(platform).some((option) => option.value === shell)
    ? shell
    : defaultShell(platform)
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/**
 * The default global hotkey. `Command` does not exist off macOS, and a bare
 * `Control+Space` would collide with every IME on Windows, so the Windows
 * default adds Alt.
 */
export function defaultHotkey(platform: Platform): string {
  return isWindows(platform) ? 'Control+Alt+Space' : 'Control+Command+Space'
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const MAC_FONTS = ['SF Mono', 'Menlo', 'Monaco']
const WINDOWS_FONTS = ['Cascadia Mono', 'Consolas', 'Lucida Console']
const PORTABLE_FONTS = ['JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Courier New']

/** Candidates only; the renderer filters these to fonts actually installed. */
export function codeFonts(platform: Platform): string[] {
  return [...(isWindows(platform) ? WINDOWS_FONTS : MAC_FONTS), ...PORTABLE_FONTS]
}

export function defaultCodeFont(platform: Platform): string {
  return codeFonts(platform)[0]
}

// ---------------------------------------------------------------------------

/** The slice of the defaults that has no single cross-platform answer. */
export function platformDefaults(platform: Platform): Partial<AppSettings> {
  return {
    shell: defaultShell(platform),
    codeFont: defaultCodeFont(platform),
    globalHotkey: defaultHotkey(platform)
  }
}
