import { useEffect } from 'react'

/**
 * Tell main which conversation this window is showing so the Dock badge
 * and completed-but-unseen tray rows drop when the window is focused
 * (or when the user switches to it).
 */
export function useAttentionSeen(conversationId: string | null | undefined): void {
  useEffect(() => {
    const id = conversationId?.trim()
    if (!id || !window.vav?.notifications?.seen) return
    const report = (): void => {
      if (document.visibilityState === 'hidden') return
      window.vav.notifications.seen(id)
    }
    const onVis = (): void => {
      if (document.visibilityState === 'visible') report()
    }
    report()
    window.addEventListener('focus', report)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', report)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [conversationId])
}
