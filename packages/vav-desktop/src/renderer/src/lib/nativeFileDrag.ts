import type { DragEvent } from 'react'
import { isLocalMachine } from '@shared/workspaceHost'
import {
  beginInAppFileDrag,
  clearInAppFileDrag,
  VAV_FILE_PATHS_TYPE
} from './inAppFileDrag'
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
 *
 * Files also record an in-app path so dropping on the conversation pins a
 * composer attachment even when `startDrag` hides HTML5 `Files` data.
 */
export function nativeFileDragProps(
  path: string,
  opts?: { isDirectory?: boolean }
): {
  draggable: boolean
  'data-native-file-drag'?: 'true'
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onPointerDown: () => void
} {
  const hasPath = Boolean(path)
  const native =
    hasPath &&
    sessionAllowsNativeFileDrag() &&
    typeof window.vav?.files?.startDrag === 'function'
  const inApp = hasPath && !opts?.isDirectory

  return {
    draggable: native || inApp,
    ...(native ? { 'data-native-file-drag': 'true' as const } : {}),
    onPointerDown: () => {
      if (native) void window.vav.files.prefetchDragIcon?.(path)
    },
    onDragStart: (event) => {
      if (!hasPath) return
      if (inApp) beginInAppFileDrag([path])
      if (native) {
        event.preventDefault()
        event.stopPropagation()
        window.vav.files.startDrag([path])
        return
      }
      if (!inApp) {
        event.preventDefault()
        return
      }
      event.dataTransfer.setData(VAV_FILE_PATHS_TYPE, JSON.stringify([path]))
      event.dataTransfer.setData('text/plain', path)
      event.dataTransfer.effectAllowed = 'copy'
    },
    onDragEnd: () => {
      clearInAppFileDrag()
    }
  }
}
