/**
 * Product keyboard shortcuts — defaults, resolve, match, and display.
 *
 * Canonical form is an Electron accelerator string (e.g. `CmdOrCtrl+Shift+H`).
 * Overrides live in `AppSettings.keyBindings`; missing ids use defaults.
 */

import type { MessageKey } from './i18n/messages'
import { isMac, type Platform } from './platform'

export type KeyBindingKind = 'accelerator' | 'sendKey' | 'globalHotkey' | 'readonly'

export type KeyBindingGroupId =
  | 'session'
  | 'chrome'
  | 'find'
  | 'focus'
  | 'terminal'
  | 'special'
  | 'files'

/** Remappable accelerator ids (stored in `AppSettings.keyBindings`). */
export type AcceleratorKeyBindingId =
  | 'newSession'
  | 'newSessionWindow'
  | 'focusComposer'
  | 'focusComposerAlt'
  | 'sendMenu'
  | 'toggleSidebar'
  | 'toggleTools'
  | 'togglePanelSegment'
  | 'focusBash'
  | 'switchWorkdir'
  | 'switchCliMode'
  | 'switchVavMode'
  | 'switchModel'
  | 'switchApproval'
  | 'closeContext'
  | 'openSettings'
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'newTerminal'
  | 'focusTools1'
  | 'focusTools2'
  | 'focusTools3'
  | 'focusTools4'
  | 'focusTools5'
  | 'focusTools6'
  | 'focusTools7'
  | 'focusTools8'
  | 'focusTools9'

export type KeyBindingId = AcceleratorKeyBindingId | 'sendKey' | 'globalHotkey' | 'quickLook'

export interface KeyBindingDef {
  id: KeyBindingId
  group: KeyBindingGroupId
  labelKey: MessageKey
  kind: KeyBindingKind
  /** Default Electron accelerator; empty for non-accelerator kinds. */
  defaultAccelerator: string
  /** macOS-only rows (e.g. Quick Look). */
  macOnly?: boolean
}

export const KEY_BINDING_GROUP_LABEL: Record<KeyBindingGroupId, MessageKey> = {
  session: 'keybindings.group.session',
  chrome: 'keybindings.group.chrome',
  find: 'keybindings.group.find',
  focus: 'keybindings.group.focus',
  terminal: 'keybindings.group.terminal',
  special: 'keybindings.group.special',
  files: 'keybindings.group.files'
}

export const KEY_BINDING_DEFS: readonly KeyBindingDef[] = [
  {
    id: 'sendKey',
    group: 'special',
    labelKey: 'appearance.sendKey',
    kind: 'sendKey',
    defaultAccelerator: ''
  },
  {
    id: 'globalHotkey',
    group: 'special',
    labelKey: 'appearance.hotkey',
    kind: 'globalHotkey',
    defaultAccelerator: ''
  },
  {
    id: 'newSession',
    group: 'session',
    labelKey: 'shortcut.newSession',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+N'
  },
  {
    id: 'newSessionWindow',
    group: 'session',
    labelKey: 'shortcut.newSessionWindow',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+Return'
  },
  {
    id: 'focusComposer',
    group: 'session',
    labelKey: 'shortcut.focusComposer',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+K'
  },
  {
    id: 'focusComposerAlt',
    group: 'session',
    labelKey: 'shortcut.focusComposerAlt',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+I'
  },
  {
    id: 'sendMenu',
    group: 'session',
    labelKey: 'shortcut.send',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Return'
  },
  {
    id: 'openSettings',
    group: 'chrome',
    labelKey: 'shortcut.settings',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+,'
  },
  {
    id: 'toggleSidebar',
    group: 'chrome',
    labelKey: 'shortcut.sidebar',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+H'
  },
  {
    id: 'toggleTools',
    group: 'chrome',
    labelKey: 'shortcut.tools',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+E'
  },
  {
    id: 'togglePanelSegment',
    group: 'chrome',
    labelKey: 'menu.togglePanelSegment',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+T'
  },
  {
    id: 'focusBash',
    group: 'chrome',
    labelKey: 'menu.focusBash',
    kind: 'accelerator',
    defaultAccelerator: 'Control+`'
  },
  {
    id: 'switchWorkdir',
    group: 'chrome',
    labelKey: 'shortcut.switchWorkdir',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+O'
  },
  {
    id: 'switchCliMode',
    group: 'chrome',
    labelKey: 'shortcut.switchCliMode',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+C'
  },
  {
    id: 'switchVavMode',
    group: 'chrome',
    labelKey: 'shortcut.switchVavMode',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+V'
  },
  {
    id: 'switchModel',
    group: 'session',
    labelKey: 'shortcut.switchModel',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+M'
  },
  {
    id: 'switchApproval',
    group: 'session',
    labelKey: 'shortcut.switchApproval',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+P'
  },
  {
    id: 'closeContext',
    group: 'chrome',
    labelKey: 'menu.closeWindow',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+W'
  },
  {
    id: 'find',
    group: 'find',
    labelKey: 'shortcut.find',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+F'
  },
  {
    id: 'findNext',
    group: 'find',
    labelKey: 'menu.findNext',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+G'
  },
  {
    id: 'findPrevious',
    group: 'find',
    labelKey: 'menu.findPrevious',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+Shift+G'
  },
  {
    id: 'newTerminal',
    group: 'terminal',
    labelKey: 'menu.newTerminal',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+T'
  },
  {
    id: 'focusTools1',
    group: 'focus',
    labelKey: 'menu.focusWorkspace',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+1'
  },
  {
    id: 'focusTools2',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal2',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+2'
  },
  {
    id: 'focusTools3',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal3',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+3'
  },
  {
    id: 'focusTools4',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal4',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+4'
  },
  {
    id: 'focusTools5',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal5',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+5'
  },
  {
    id: 'focusTools6',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal6',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+6'
  },
  {
    id: 'focusTools7',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal7',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+7'
  },
  {
    id: 'focusTools8',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal8',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+8'
  },
  {
    id: 'focusTools9',
    group: 'focus',
    labelKey: 'keybindings.focusTerminal9',
    kind: 'accelerator',
    defaultAccelerator: 'CmdOrCtrl+9'
  },
  {
    id: 'quickLook',
    group: 'files',
    labelKey: 'shortcut.quickLook',
    kind: 'readonly',
    defaultAccelerator: 'Space',
    macOnly: true
  }
]

const ACCELERATOR_IDS = KEY_BINDING_DEFS.filter((d) => d.kind === 'accelerator').map(
  (d) => d.id as AcceleratorKeyBindingId
)

const DEFAULT_ACCELERATORS: Record<AcceleratorKeyBindingId, string> = Object.fromEntries(
  KEY_BINDING_DEFS.filter((d) => d.kind === 'accelerator').map((d) => [
    d.id,
    d.defaultAccelerator
  ])
) as Record<AcceleratorKeyBindingId, string>

export type ResolvedKeyBindings = Record<AcceleratorKeyBindingId, string>

export function isAcceleratorKeyBindingId(id: string): id is AcceleratorKeyBindingId {
  return Object.prototype.hasOwnProperty.call(DEFAULT_ACCELERATORS, id)
}

/** Merge overrides onto defaults; drop empty / unknown ids. */
export function resolveKeyBindings(
  overrides: Partial<Record<string, string>> | undefined | null
): ResolvedKeyBindings {
  const resolved = { ...DEFAULT_ACCELERATORS }
  if (!overrides || typeof overrides !== 'object') return resolved
  for (const id of ACCELERATOR_IDS) {
    const value = overrides[id]
    if (typeof value === 'string' && value.trim()) {
      resolved[id] = value.trim()
    }
  }
  return resolved
}

/** Persist-safe overrides: only known accelerator ids with non-empty strings. */
export function sanitizeKeyBindings(
  raw: unknown
): Partial<Record<AcceleratorKeyBindingId, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<AcceleratorKeyBindingId, string>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAcceleratorKeyBindingId(key)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    // Skip no-ops that equal the default (keeps the file small).
    if (trimmed === DEFAULT_ACCELERATORS[key]) continue
    out[key] = trimmed
  }
  return out
}

const MOD_ORDER = ['CmdOrCtrl', 'Command', 'Control', 'Alt', 'Shift'] as const

function canonicalMod(raw: string): string | null {
  const m = raw.toLowerCase()
  if (m === 'cmdorctrl' || m === 'commandorcontrol') return 'CmdOrCtrl'
  if (m === 'command' || m === 'cmd' || m === 'super' || m === 'meta') return 'Command'
  if (m === 'control' || m === 'ctrl') return 'Control'
  if (m === 'alt' || m === 'option') return 'Alt'
  if (m === 'shift') return 'Shift'
  return null
}

function canonicalKey(raw: string): string {
  if (raw === 'Enter') return 'Return'
  if (raw.length === 1 && /[a-z]/.test(raw)) return raw.toUpperCase()
  return raw
}

/** Platform-expanded, sorted form for equality / conflict checks. */
export function normalizeAccelerator(accelerator: string, platform: Platform): string {
  const parts = accelerator.split('+').filter(Boolean)
  if (parts.length === 0) return ''
  const key = canonicalKey(parts[parts.length - 1]!)
  const mods: string[] = []
  for (const part of parts.slice(0, -1)) {
    const mod = canonicalMod(part)
    if (!mod) continue
    if (mod === 'CmdOrCtrl') {
      mods.push(isMac(platform) ? 'Command' : 'Control')
    } else {
      mods.push(mod)
    }
  }
  const unique = [...new Set(mods)]
  unique.sort((a, b) => {
    const ai = MOD_ORDER.indexOf(a as (typeof MOD_ORDER)[number])
    const bi = MOD_ORDER.indexOf(b as (typeof MOD_ORDER)[number])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return [...unique, key].join('+')
}

export function acceleratorsConflict(
  a: string,
  b: string,
  platform: Platform
): boolean {
  if (!a || !b) return false
  return normalizeAccelerator(a, platform) === normalizeAccelerator(b, platform)
}

/** Find another binding (or global hotkey) that already uses this chord. */
export function findKeyBindingConflict(
  candidate: string,
  exceptId: AcceleratorKeyBindingId | 'globalHotkey',
  bindings: ResolvedKeyBindings,
  globalHotkey: string,
  platform: Platform
): KeyBindingId | null {
  if (!candidate.trim()) return null
  for (const id of ACCELERATOR_IDS) {
    if (id === exceptId) continue
    if (acceleratorsConflict(candidate, bindings[id], platform)) return id
  }
  if (exceptId !== 'globalHotkey' && globalHotkey) {
    if (acceleratorsConflict(candidate, globalHotkey, platform)) return 'globalHotkey'
  }
  return null
}

export interface ParsedAccelerator {
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

export function parseAccelerator(
  accelerator: string,
  platform: Platform
): ParsedAccelerator | null {
  const parts = accelerator.split('+').filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]!
  let meta = false
  let control = false
  let alt = false
  let shift = false
  for (const part of parts.slice(0, -1)) {
    const mod = canonicalMod(part)
    if (!mod) continue
    if (mod === 'CmdOrCtrl') {
      if (isMac(platform)) meta = true
      else control = true
    } else if (mod === 'Command') meta = true
    else if (mod === 'Control') control = true
    else if (mod === 'Alt') alt = true
    else if (mod === 'Shift') shift = true
  }
  return { key, meta, control, alt, shift }
}

function inputKeyMatches(accelKey: string, input: { key: string; code: string }): boolean {
  const k = accelKey
  if (k === 'Return' || k === 'Enter') {
    return input.key === 'Enter' || input.code === 'Enter' || input.code === 'NumpadEnter'
  }
  if (k === 'Space') return input.code === 'Space' || input.key === ' '
  if (k === ',') return input.key === ',' || input.code === 'Comma'
  if (k === '`') {
    return input.key === '`' || input.key === '~' || input.code === 'Backquote'
  }
  if (k === '-') return input.key === '-' || input.code === 'Minus'
  if (k === '=') return input.key === '=' || input.code === 'Equal'
  if (k === '[') return input.key === '[' || input.code === 'BracketLeft'
  if (k === ']') return input.key === ']' || input.code === 'BracketRight'
  if (k === '\\') return input.key === '\\' || input.code === 'Backslash'
  if (k === ';') return input.key === ';' || input.code === 'Semicolon'
  if (k === "'") return input.key === "'" || input.code === 'Quote'
  if (k === '.') return input.key === '.' || input.code === 'Period'
  if (k === '/') return input.key === '/' || input.code === 'Slash'
  if (k.length === 1 && /[a-zA-Z]/.test(k)) {
    const upper = k.toUpperCase()
    const lower = k.toLowerCase()
    return (
      (input.key.length === 1 && input.key.toLowerCase() === lower) ||
      input.code === `Key${upper}`
    )
  }
  if (k.length === 1 && /[0-9]/.test(k)) {
    return input.key === k || input.code === `Digit${k}`
  }
  if (/^F\d{1,2}$/i.test(k)) {
    return input.key.toUpperCase() === k.toUpperCase() || input.code.toUpperCase() === k.toUpperCase()
  }
  return input.key === k || input.code === k
}

export type AcceleratorInput = {
  type: string
  key: string
  code: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export function matchesAccelerator(
  input: AcceleratorInput,
  accelerator: string,
  platform: Platform
): boolean {
  if (input.type !== 'keyDown') return false
  const parsed = parseAccelerator(accelerator, platform)
  if (!parsed) return false
  if (parsed.meta !== input.meta) return false
  if (parsed.control !== input.control) return false
  if (parsed.alt !== input.alt) return false
  if (parsed.shift !== input.shift) return false
  return inputKeyMatches(parsed.key, input)
}

const MODIFIER_SYMBOL: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  CmdOrCtrl: '⌘',
  CommandOrControl: '⌘'
}

const WINDOWS_MOD: Record<string, string> = {
  Command: 'Ctrl',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  CmdOrCtrl: 'Ctrl',
  CommandOrControl: 'Ctrl'
}

/** Pretty-print an Electron accelerator for the given platform. */
export function prettyAccelerator(
  accelerator: string,
  platform: Platform,
  notSet = ''
): string {
  if (!accelerator) return notSet
  const parts = accelerator.split('+').filter(Boolean)
  if (parts.length === 0) return notSet
  const key = parts[parts.length - 1]!
  const displayKey = key === 'Return' ? (isMac(platform) ? '↵' : 'Enter') : key

  if (isMac(platform)) {
    return parts
      .slice(0, -1)
      .map((part) => {
        if (part === 'CmdOrCtrl' || part === 'CommandOrControl') return '⌘'
        return MODIFIER_SYMBOL[part] ?? part
      })
      .join('') + displayKey
  }

  const mods = parts.slice(0, -1).map((part) => WINDOWS_MOD[part] ?? part)
  // Dedupe Ctrl when both Command and Control appear after expansion.
  const unique = [...new Set(mods)]
  return [...unique, displayKey === '↵' ? 'Enter' : displayKey].join('+')
}

/** DOM key event → Electron accelerator key token (no modifiers). */
export function normalizeKeyFromEvent(event: {
  code: string
  key: string
}): string | null {
  const code = event.code
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Arrow')) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  return named[code] ?? null
}

/** Build an Electron accelerator from a keydown event. */
export function acceleratorFromEvent(
  event: {
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
    code: string
    key: string
  },
  platform: Platform
): string | null {
  const key = normalizeKeyFromEvent(event)
  if (!key) return null
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Command')
  if (modifiers.length === 0) return null

  // Prefer CmdOrCtrl when the primary modifier alone matches the platform.
  const isPrimaryOnly =
    (isMac(platform) && event.metaKey && !event.ctrlKey) ||
    (!isMac(platform) && event.ctrlKey && !event.metaKey)
  if (isPrimaryOnly) {
    const rest = [
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey ? ['Shift'] : [])
    ]
    return ['CmdOrCtrl', ...rest, key].join('+')
  }
  return [...modifiers, key].join('+')
}

export function defaultAccelerator(id: AcceleratorKeyBindingId): string {
  return DEFAULT_ACCELERATORS[id]
}

export function acceleratorKeyBindingIds(): AcceleratorKeyBindingId[] {
  return ACCELERATOR_IDS.slice()
}
