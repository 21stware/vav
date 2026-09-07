import type { DragEvent } from 'react'
import { isLocalMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'

/** Native file drag/copy/Get Info only work for files on this machine. */
export function nativeFileDragAllowed(machineId: string | null | undefined): boolean {
  return isLocalMachine(machineId)
}

export function sessionAllowsNativeFileDrag(): boolean {
  const state = useSessionStore.getState()
  const conversation = state.conversations.find((item) => item.id === state.activeId)
  return nativeFileDragAllowed(conversation?.machineId ?? state.windowMachineId)
}

export function nativeOsFileActionsAvailable(): boolean {
  const platform = window.vav?.platform
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Spread onto a Files-row / preview title so a drag leaves the window as a
 * real OS file (`webContents.startDrag`), not a Chromium HTML ghost.
 */
export function nativeFileDragProps(path: string): {
  draggable: boolean
  'data-native-file-drag'?: 'true'
  onDragStart: (event: DragEvent) => void
  onPointerDown: () => void
} {
  const enabled =
    Boolean(path) &&
    sessionAllowsNativeFileDrag() &&
    typeof window.vav?.files?.startDrag === 'function'

  return {
    draggable: enabled,
    ...(enabled ? { 'data-native-file-drag': 'true' as const } : {}),
    onPointerDown: () => {
      if (!enabled) return
      void window.vav.files.prefetchDragIcon?.(path)
    },
    onDragStart: (event) => {
      if (!enabled) return
      event.preventDefault()
      event.stopPropagation()
      window.vav.files.startDrag([path])
    }
  }
}
