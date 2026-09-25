import type { ApplicationsMode } from '../state/sessionTypes'
import { applicationsModeForConversation } from './applicationsWidth'

export type AppColumnObjectRow = {
  id: string
  fileId?: string | null
  sessionKind?: string | null
  timerRunId?: string | null
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
