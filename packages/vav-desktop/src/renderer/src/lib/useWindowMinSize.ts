import { useEffect, useState } from 'react'
import {
  AGENT_MIN_WIDTH,
  PIP_WINDOW_MIN_HEIGHT,
  PIP_WINDOW_MIN_WIDTH,
  windowMinHeight,
  windowMinWidth,
  type WindowShellKind
} from '@shared/shellMinSize'
import { useSessionStore } from '../state/sessionStore'
import { loadSidebarWidth, SIDEBAR_WIDTH_CHANGED } from './sidebarWidth'
import { isCompanionSessionShell } from './windowKind'

/** File-session agent drawer used to report width; the main shell no longer hosts it. */
export function reportFileSessionAgentOpen(_open: boolean | null, _width?: number): void {}

/**
 * Push column floors onto the native BrowserWindow min-size so the frame
 * cannot be dragged smaller than the visible chrome actually occupies.
 */
export function useWindowMinSize(): void {
  const pictureInPicture = useSessionStore((s) => s.pictureInPicture)
  const shell: WindowShellKind = isCompanionSessionShell() ? 'session' : 'main'
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const applicationsVisible = useSessionStore((s) => s.applicationsVisible)
  const agentVisible = useSessionStore((s) => s.agentVisible)
  const toolsCollapsed = useSessionStore((s) => s.toolsCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)

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

  const width = pictureInPicture
    ? PIP_WINDOW_MIN_WIDTH
    : windowMinWidth({
        sidebarVisible: shell === 'main',
        sidebarRail: shell === 'main' && !sidebarVisible,
        sidebarWidth: sidebarVisible ? sidebarWidth : undefined,
        agentVisible: shell === 'main' ? agentVisible : true,
        agentMinWidth: AGENT_MIN_WIDTH,
        previewVisible: shell === 'main' && applicationsVisible,
        // Floor only — never the live column width. applyWindowMinSize grows the
        // frame when it is below the floor; a live width then raises the floor
        // again (window walks off-screen).
        previewWidth: undefined,
        shell
      })
  const height = pictureInPicture
    ? PIP_WINDOW_MIN_HEIGHT
    : windowMinHeight({
        workbenchExpanded: !toolsCollapsed,
        shell
      })

  useEffect(() => {
    const api = window.vav?.window?.setMinSize
    if (typeof api === 'function') void api({ width, height })
  }, [width, height])
}
