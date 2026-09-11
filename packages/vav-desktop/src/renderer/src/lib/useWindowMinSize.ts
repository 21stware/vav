import { useEffect, useState } from 'react'
import {
  AGENT_MIN_WIDTH,
  FILE_SESSION_AGENT_MIN_WIDTH,
  windowMinHeight,
  windowMinWidth,
  type WindowShellKind
} from '@shared/shellMinSize'
import { isDbSession } from '@shared/sessionKind'
import { useSessionStore } from '../state/sessionStore'
import { loadSidebarWidth, SIDEBAR_WIDTH_CHANGED } from './sidebarWidth'
import { isCompanionSessionShell } from './windowKind'

let fileSessionAgentOpen: boolean | null = null
let fileSessionAgentWidth: number | null = null
let workspacePreviewWidth: number | null = null
const columnListeners = new Set<() => void>()

function emitColumns(): void {
  for (const listener of columnListeners) listener()
}

/** File-session agent drawer — null when that surface is unmounted. */
export function reportFileSessionAgentOpen(open: boolean | null, width?: number): void {
  const nextWidth = open && typeof width === 'number' && Number.isFinite(width) ? width : null
  if (fileSessionAgentOpen === open && fileSessionAgentWidth === nextWidth) return
  fileSessionAgentOpen = open
  fileSessionAgentWidth = nextWidth
  emitColumns()
}

/** Workspace right-hand preview drawer width while it is open. */
export function reportWorkspacePreviewWidth(width: number | null): void {
  const next = width != null && Number.isFinite(width) ? width : null
  if (workspacePreviewWidth === next) return
  workspacePreviewWidth = next
  emitColumns()
}

function subscribeShellColumns(listener: () => void): () => void {
  columnListeners.add(listener)
  return () => {
    columnListeners.delete(listener)
  }
}

/**
 * Push column floors onto the native BrowserWindow min-size so the frame
 * cannot be dragged smaller than the visible chrome actually occupies.
 */
export function useWindowMinSize(): void {
  const shell: WindowShellKind = isCompanionSessionShell() ? 'session' : 'main'
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const previewOpen = useSessionStore((s) => s.filePreviewOpen)
  const toolsCollapsed = useSessionStore((s) => s.toolsCollapsed)
  const conversation = useSessionStore((s) =>
    s.conversations.find((row) => row.id === s.activeId)
  )
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [fileAgentOpen, setFileAgentOpen] = useState(() => fileSessionAgentOpen)
  const [fileAgentWidth, setFileAgentWidth] = useState(() => fileSessionAgentWidth)
  const [previewWidth, setPreviewWidth] = useState(() => workspacePreviewWidth)

  useEffect(() => {
    const onWidth = (event: Event): void => {
      const detail = (event as CustomEvent<number>).detail
      if (typeof detail === 'number' && Number.isFinite(detail)) {
        setSidebarWidth(detail)
        return
      }
      setSidebarWidth(loadSidebarWidth())
    }
    window.addEventListener(SIDEBAR_WIDTH_CHANGED, onWidth)
    return () => window.removeEventListener(SIDEBAR_WIDTH_CHANGED, onWidth)
  }, [])

  useEffect(
    () =>
      subscribeShellColumns(() => {
        setFileAgentOpen(fileSessionAgentOpen)
        setFileAgentWidth(fileSessionAgentWidth)
        setPreviewWidth(workspacePreviewWidth)
      }),
    []
  )

  const isFileSession = Boolean(conversation?.fileId)
  const previewVisible =
    shell === 'main' && (isFileSession || isDbSession(conversation ?? {}) || previewOpen)
  const agentVisible = isFileSession ? fileAgentOpen !== false : true

  const width = windowMinWidth({
    sidebarVisible: shell === 'main' && sidebarVisible,
    sidebarWidth,
    agentVisible,
    agentMinWidth: isFileSession ? FILE_SESSION_AGENT_MIN_WIDTH : AGENT_MIN_WIDTH,
    agentWidth: isFileSession ? (fileAgentWidth ?? undefined) : undefined,
    previewVisible,
    previewWidth: isFileSession || isDbSession(conversation ?? {}) ? undefined : previewWidth ?? undefined,
    shell
  })
  const height = windowMinHeight({
    workbenchExpanded: !toolsCollapsed,
    shell
  })

  useEffect(() => {
    const api = window.vav?.window?.setMinSize
    if (typeof api !== 'function') return
    void api({ width, height })
  }, [width, height])
}
