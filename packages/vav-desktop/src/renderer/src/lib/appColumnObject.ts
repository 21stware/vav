import { conversationOnMachine } from '@shared/workspaceHost'
import type { ApplicationsMode } from '../state/sessionTypes'
import { applicationsModeForConversation } from './applicationsWidth'

export type AppColumnObjectRow = {
  id: string
  fileId?: string | null
  sessionKind?: string | null
  timerRunId?: string | null
  machineId?: string | null
}

export function focusedAppObjectIdForMode(
  state: {
    applicationsMode: ApplicationsMode
    focusedAppObjectId: string | null
    focusedAppObjectByMode: Partial<Record<ApplicationsMode, string | null>>
  },
  mode: ApplicationsMode
): string | null {
  if (state.applicationsMode === mode) return state.focusedAppObjectId
  return state.focusedAppObjectByMode[mode] ?? null
}

export function conversationForAppMode<T extends AppColumnObjectRow>(
  state: {
    applicationsMode: ApplicationsMode
    focusedAppObjectId: string | null
    focusedAppObjectByMode: Partial<Record<ApplicationsMode, string | null>>
    activeId: string
    conversations: T[]
  },
  mode: ApplicationsMode
): T | undefined {
  const focusedId = focusedAppObjectIdForMode(state, mode)
  const focused = focusedId ? state.conversations.find((row) => row.id === focusedId) : undefined
  if (focused && applicationsModeForConversation(focused) === mode) return focused
  if (state.applicationsMode !== mode) return undefined
  const active = state.conversations.find((row) => row.id === state.activeId)
  if (active && applicationsModeForConversation(active) === mode) return active
  return undefined
}

/** Null when `mode` is already remembered — caller should skip setState. */
export function rememberVisitedAppMode(
  visited: readonly ApplicationsMode[],
  mode: ApplicationsMode
): ApplicationsMode[] | null {
  return visited.includes(mode) ? null : [...visited, mode]
}

/** Drop app-column focus that does not belong on the device just switched to. */
export function appColumnFocusForMachine<T extends { id: string; machineId?: string | null }>(
  state: {
    conversations: readonly T[]
    focusedAppObjectId: string | null
    selectedAppObjectIds: readonly string[]
    focusedAppObjectByMode: Partial<Record<ApplicationsMode, string | null>>
    selectedAppObjectIdsByMode: Partial<Record<ApplicationsMode, string[]>>
    applicationsDetailOpen: boolean
  },
  machineId: string
): {
  focusedAppObjectId: string | null
  selectedAppObjectIds: string[]
  focusedAppObjectByMode: Partial<Record<ApplicationsMode, string | null>>
  selectedAppObjectIdsByMode: Partial<Record<ApplicationsMode, string[]>>
  applicationsDetailOpen: boolean
} {
  const keepId = (id: string | null | undefined): string | null => {
    if (!id) return null
    const row = state.conversations.find((item) => item.id === id)
    return row && conversationOnMachine(row, machineId) ? id : null
  }
  const focusedAppObjectId = keepId(state.focusedAppObjectId)
  const selectedAppObjectIds = state.selectedAppObjectIds.filter((id) => keepId(id))
  const focusedAppObjectByMode = Object.fromEntries(
    Object.entries(state.focusedAppObjectByMode).map(([mode, id]) => [mode, keepId(id)])
  ) as Partial<Record<ApplicationsMode, string | null>>
  const selectedAppObjectIdsByMode = Object.fromEntries(
    Object.entries(state.selectedAppObjectIdsByMode).map(([mode, ids]) => [
      mode,
      (ids ?? []).filter((id) => keepId(id))
    ])
  ) as Partial<Record<ApplicationsMode, string[]>>
  return {
    focusedAppObjectId,
    selectedAppObjectIds,
    focusedAppObjectByMode,
    selectedAppObjectIdsByMode,
    applicationsDetailOpen: focusedAppObjectId ? state.applicationsDetailOpen : false
  }
}
