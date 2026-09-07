/**
 * Resolve the theme / tint / pattern a window should paint for a given machine.
 * Per-connection overlays inherit any field the user has not set, then the
 * remote host's own look, then this desktop's global appearance.
 */

import {
  COLOR_TINTS,
  SURFACE_PATTERNS,
  type AppSettings,
  type ColorTint,
  type MachineAppearance,
  type SurfacePattern,
  type ThemeMode
} from './types.ts'
import { isLocalMachine, LOCAL_MACHINE_ID, normalizeMachineId } from './workspaceHost.ts'

const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system']

export type ResolvedMachineAppearance = {
  theme: ThemeMode
  colorTint: ColorTint
  customAccentColor: string
  surfacePattern: SurfacePattern
  customSurfacePatternUrl: string
  customSurfacePatternSize: string
}

const SETTINGS_LOOK_KEYS = [
  'theme',
  'colorTint',
  'customAccentColor',
  'surfacePattern',
  'customSurfacePatternUrl',
  'customSurfacePatternSize',
  'machineAppearances',
  'hostAppearanceBases'
] as const

export type AppearanceSettingsPick = Pick<AppSettings, (typeof SETTINGS_LOOK_KEYS)[number]>

/** Remote host look — preset pattern only; custom tiles stay on that machine. */
export function pickAppearanceBase(
  source: Partial<AppSettings> | Record<string, unknown> | null | undefined
): MachineAppearance {
  if (!source) return {}
  const out: MachineAppearance = {}
  const theme = source.theme
  if (theme === 'light' || theme === 'dark' || theme === 'system') out.theme = theme
  const tint = source.colorTint
  if (typeof tint === 'string' && COLOR_TINTS.includes(tint as ColorTint)) {
    out.colorTint = tint as ColorTint
  }
  if (typeof source.customAccentColor === 'string' && source.customAccentColor.trim()) {
    out.customAccentColor = source.customAccentColor.trim()
  }
  const pattern = source.surfacePattern
  if (
    typeof pattern === 'string' &&
    SURFACE_PATTERNS.includes(pattern as SurfacePattern) &&
    pattern !== 'custom'
  ) {
    out.surfacePattern = pattern as SurfacePattern
  }
  return out
}

export function appearanceBaseForMachine(
  settings: Pick<AppSettings, 'hostAppearanceBases'>,
  machineId: string | null | undefined,
  hosts?: readonly { id: string; appearance?: MachineAppearance }[]
): MachineAppearance | null {
  const id = normalizeMachineId(machineId)
  if (isLocalMachine(id)) return null
  return hosts?.find((host) => host.id === id)?.appearance ?? settings.hostAppearanceBases?.[id] ?? null
}

export function appearanceForMachine(
  settings: AppearanceSettingsPick,
  machineId?: string | null,
  base?: MachineAppearance | null
): ResolvedMachineAppearance {
  const id = normalizeMachineId(machineId)
  const override = settings.machineAppearances?.[id]
  const inherited = isLocalMachine(id)
    ? null
    : (base ?? settings.hostAppearanceBases?.[id] ?? null)

  const theme =
    override?.theme && THEMES.includes(override.theme)
      ? override.theme
      : inherited?.theme && THEMES.includes(inherited.theme)
        ? inherited.theme
        : settings.theme

  const tint = override?.colorTint
  const inheritedTint = inherited?.colorTint
  const colorTint =
    tint && COLOR_TINTS.includes(tint)
      ? tint
      : inheritedTint && COLOR_TINTS.includes(inheritedTint)
        ? inheritedTint
        : settings.colorTint

  const custom =
    colorTint === 'custom'
      ? override?.customAccentColor?.trim() ||
        inherited?.customAccentColor?.trim() ||
        settings.customAccentColor ||
        ''
      : settings.customAccentColor

  const overridePattern = override?.surfacePattern
  const inheritedPattern =
    inherited?.surfacePattern && inherited.surfacePattern !== 'custom'
      ? inherited.surfacePattern
      : undefined
  const surfacePattern =
    overridePattern && SURFACE_PATTERNS.includes(overridePattern)
      ? overridePattern
      : (inheritedPattern ?? settings.surfacePattern)

  const customSurfacePatternUrl =
    surfacePattern === 'custom'
      ? override?.customSurfacePatternUrl?.trim() || settings.customSurfacePatternUrl || ''
      : settings.customSurfacePatternUrl
  const customSurfacePatternSize =
    surfacePattern === 'custom'
      ? override?.customSurfacePatternSize?.trim() || settings.customSurfacePatternSize || ''
      : settings.customSurfacePatternSize

  return {
    theme,
    colorTint,
    customAccentColor: custom,
    surfacePattern,
    customSurfacePatternUrl,
    customSurfacePatternSize
  }
}

export function patchMachineAppearance(
  current: Record<string, MachineAppearance> | undefined,
  machineId: string | null | undefined,
  patch: MachineAppearance
): Record<string, MachineAppearance> {
  const id = normalizeMachineId(machineId) || LOCAL_MACHINE_ID
  const prev = current?.[id] ?? {}
  const next: MachineAppearance = { ...prev, ...patch }
  const cleaned: MachineAppearance = {}
  if (next.theme) cleaned.theme = next.theme
  if (next.colorTint) cleaned.colorTint = next.colorTint
  if (next.customAccentColor?.trim()) cleaned.customAccentColor = next.customAccentColor.trim()
  if (next.surfacePattern && SURFACE_PATTERNS.includes(next.surfacePattern)) {
    cleaned.surfacePattern = next.surfacePattern
  }
  if (next.customSurfacePatternUrl?.trim()) {
    cleaned.customSurfacePatternUrl = next.customSurfacePatternUrl.trim()
  }
  if (next.customSurfacePatternSize?.trim()) {
    cleaned.customSurfacePatternSize = next.customSurfacePatternSize.trim()
  }
  return { ...(current ?? {}), [id]: cleaned }
}
