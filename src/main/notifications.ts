import {
  Notification,
  app,
  type BrowserWindow
} from 'electron'
import type { AppSettings } from '@shared/types'
import { applyDockIcon } from './brand'

export type NotifyKind = 'turn-complete' | 'ask' | 'approval' | 'request'
export type NotificationPermission = 'granted' | 'denied' | 'unknown'

/**
 * OS notifications (settings-notifications.rpml).
 *
 * Menu-bar tray was removed from product; Dock stays visible so the app never
 * vanishes without a back door.
 *
 * Electron's Notification API maps to UserNotifications on macOS; permission
 * is requested the first time a notification would fire.
 */
export class NotificationCenter {
  private permissionAsked = false
  private lastPermission: NotificationPermission = 'unknown'

  constructor(
    private getSettings: () => AppSettings,
    private onOpenConversation: (conversationId: string) => void,
    _onOpenSettings: () => void,
    _getMainWindow: () => BrowserWindow | null
  ) {}

  permissionStatus(): NotificationPermission {
    this.lastPermission = readNotificationPermission()
    return this.lastPermission
  }

  applySettings(): void {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show()
      applyDockIcon()
    }
  }

  setRunningCount(_count: number): void {
    // Tray badge removed with the status item.
  }

  notify(kind: NotifyKind, conversationId: string, title: string, body: string): void {
    const settings = this.getSettings()
    if (!settings.notificationsEnabled) return
    if (kind === 'turn-complete' && !settings.notifyOnTurnComplete) return
    if (kind === 'ask' && !settings.notifyOnAskUserQuestion) return
    if (kind === 'approval' && !settings.notifyOnToolApproval) return
    if (kind === 'request' && !settings.notifyOnRequest) return

    if (!Notification.isSupported()) return
    this.lastPermission = readNotificationPermission()
    if (this.lastPermission === 'denied') return
    void this.ensurePermission()

    const notification = new Notification({
      title,
      body: truncate(body, 120),
      silent: !settings.notificationSound
    })
    notification.on('click', () => this.onOpenConversation(conversationId))
    notification.show()
  }

  private async ensurePermission(): Promise<void> {
    if (this.permissionAsked) return
    this.permissionAsked = true
    // First show triggers the system prompt on macOS when still undetermined.
  }

  /** Call when turn activity changes (tray menu used to list sessions). */
  updateRunningSessions(sessions: { id: string; title: string }[]): void {
    this.setRunningCount(sessions.length)
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/** Best-effort read of macOS notification authorization; other platforms grant. */
function readNotificationPermission(): NotificationPermission {
  if (process.platform !== 'darwin') return 'granted'
  try {
    const probe = app as unknown as {
      getNotificationSettings?: () => { authorizationStatus?: string | number }
    }
    const status = probe.getNotificationSettings?.()?.authorizationStatus
    if (status === undefined || status === null) return 'unknown'
    const value = String(status).toLowerCase()
    if (value === 'denied' || value === '1') return 'denied'
    if (
      value === 'authorized' ||
      value === 'granted' ||
      value === 'provisional' ||
      value === '2' ||
      value === '3'
    ) {
      return 'granted'
    }
    if (value === 'notdetermined' || value === '0') return 'unknown'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
