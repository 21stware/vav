import { useEffect } from 'react'

/**
 * Tell main which conversation this window is showing so the Dock badge
 * drops when the window is focused (or when the user switches to it).
 */
export function useAttentionSeen(conversationId: string | null | undefined): void {
  useEffect(() => {
    const id = conversationId?.trim()
    if (!id || !window.vav?.notifications?.seen) return
    const report = (): void => {
      window.vav.notifications.seen(id)
    }
    report()
    window.addEventListener('focus', report)
    return () => window.removeEventListener('focus', report)
  }, [conversationId])
}
