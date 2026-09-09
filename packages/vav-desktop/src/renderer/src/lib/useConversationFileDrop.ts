import { useCallback, useRef, useState, type DragEvent } from 'react'
import {
  peekInAppFileDrag,
  takeInAppFileDrag,
  VAV_FILE_PATHS_TYPE
} from './inAppFileDrag'
import { imageSizeByPath } from './pasteImages'
import { useSessionStore } from '../state/sessionStore'

function parseVavFilePaths(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
  } catch {
    return []
  }
}

export function collectConversationDropPaths(data: DataTransfer | null): {
  paths: string[]
  sizes: Record<string, number>
} {
  const inApp = takeInAppFileDrag()
  if (inApp.length) return { paths: inApp, sizes: {} }
  if (data) {
    const custom = parseVavFilePaths(data.getData(VAV_FILE_PATHS_TYPE))
    if (custom.length) return { paths: custom, sizes: {} }
  }
  return imageSizeByPath([...(data?.files ?? [])])
}

function dragHasFiles(data: DataTransfer | null): boolean {
  if (peekInAppFileDrag().length > 0) return true
  if (!data) return false
  if ((data.files?.length ?? 0) > 0) return true
  for (const type of data.types) {
    if (type === 'Files' || type === VAV_FILE_PATHS_TYPE) return true
  }
  return false
}

export type ConversationFileDrop = {
  /** True while a file drag hovers the bound surface — drive the drop hint. */
  dropActive: boolean
  dropHandlers: {
    onDragEnter: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
}

/**
 * Whole-surface file drop → conversation attachments.
 *
 * Bind the returned handlers to a session surface (transcript + composer
 * shell). Enter/leave are depth-counted so hovering child nodes does not
 * flicker the hint; the overlay itself must be pointer-events: none.
 */
export function useConversationFileDrop(
  conversationId: string,
  enabled: boolean
): ConversationFileDrop {
  const [dropActive, setDropActive] = useState(false)
  const depth = useRef(0)

  const reset = useCallback((): void => {
    depth.current = 0
    setDropActive(false)
  }, [])

  const onDragEnter = useCallback(
    (event: DragEvent): void => {
      if (!enabled || !conversationId || !dragHasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current += 1
      setDropActive(true)
    },
    [enabled, conversationId]
  )

  const onDragOver = useCallback(
    (event: DragEvent): void => {
      if (!enabled || !conversationId || !dragHasFiles(event.dataTransfer)) return
      event.preventDefault()
    },
    [enabled, conversationId]
  )

  const onDragLeave = useCallback(
    (event: DragEvent): void => {
      if (!enabled || !conversationId || !dragHasFiles(event.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDropActive(false)
    },
    [enabled, conversationId]
  )

  const onDrop = useCallback(
    (event: DragEvent): void => {
      reset()
      if (!enabled || !conversationId || !dragHasFiles(event.dataTransfer)) return
      event.preventDefault()
      const { paths, sizes } = collectConversationDropPaths(event.dataTransfer)
      if (paths.length) {
        useSessionStore.getState().addAttachments(conversationId, paths, { sizes })
      }
    },
    [enabled, conversationId, reset]
  )

  return { dropActive, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
