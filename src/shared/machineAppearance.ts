/**
 * Resolve the theme / tint a window should paint for a given machine.
 * Per-connection overlays inherit any field the user has not set.
 */

import { COLOR_TINTS, type AppSettings, type ColorTint, type MachineAppearance, type ThemeMode } from './types.ts'
import { LOCAL_MACHINE_ID, normalizeMachineId } from './workspaceHost.ts'

const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system']

export function appearanceForMachine(
  settings: Pick<AppSettings, 'theme' | 'colorTint' | 'customAccentColor' | 'machineAppearances'>,
  machineId?: string | null
): { theme: ThemeMode; colorTint: ColorTint; customAccentColor: string } {
  const id = normalizeMachineId(machineId)
  const override = settings.machineAppearances?.[id]
  const theme =
    override?.theme && THEMES.includes(override.theme) ? override.theme : settings.theme
  const tint = override?.colorTint
  const colorTint = tint && COLOR_TINTS.includes(tint) ? tint : settings.colorTint
  const custom =
    colorTint === 'custom'
      ? (override?.customAccentColor?.trim() || settings.customAccentColor || '')
      : settings.customAccentColor
  return { theme, colorTint, customAccentColor: custom }
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
  return { ...(current ?? {}), [id]: cleaned }
}
