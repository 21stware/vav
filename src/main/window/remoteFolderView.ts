export type Rect = { x: number; y: number; width: number; height: number }

export type RemoteFolderPurpose = 'workdir' | 'locate' | 'directory'

/** Finder-like folder dialog — tall enough for a tree, short enough that actions stay on screen. */
export const REMOTE_FOLDER_WINDOW_WIDTH = 640
export const REMOTE_FOLDER_WINDOW_HEIGHT = 480
export const REMOTE_FOLDER_WINDOW_MIN_WIDTH = 560
export const REMOTE_FOLDER_WINDOW_MIN_HEIGHT = 400

export function isRemoteFolderPurpose(value: unknown): value is RemoteFolderPurpose {
  return value === 'workdir' || value === 'locate' || value === 'directory'
}

export function parseRemoteFolderPickRequest(raw: unknown): {
  conversationId: string
  machineId: string
  purpose: RemoteFolderPurpose
} | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const machineId = typeof rec.machineId === 'string' ? rec.machineId.trim() : ''
  if (!machineId) return null
  const conversationId = typeof rec.conversationId === 'string' ? rec.conversationId : ''
  const purpose = isRemoteFolderPurpose(rec.purpose) ? rec.purpose : 'workdir'
  return { conversationId, machineId, purpose }
}

/** Center on the parent window, clamped to the display work area. */
export function remoteFolderWindowPosition(input: {
  width: number
  height: number
  parent: Rect
  workArea: Rect
}): { x: number; y: number } {
  const { width, height, parent, workArea } = input
  let x = Math.round(parent.x + (parent.width - width) / 2)
  let y = Math.round(parent.y + (parent.height - height) / 2)
  const maxX = workArea.x + workArea.width - width - 8
  const maxY = workArea.y + workArea.height - height - 8
  x = Math.min(Math.max(workArea.x + 8, x), Math.max(workArea.x + 8, maxX))
  y = Math.min(Math.max(workArea.y + 8, y), Math.max(workArea.y + 8, maxY))
  return { x, y }
}
