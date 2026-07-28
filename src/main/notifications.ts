import {
  Notification,
  Tray,
  Menu,
  app,
  nativeImage,
  type BrowserWindow,
  type NativeImage
} from 'electron'
import type { AppSettings } from '@shared/types'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_NAME, applyDockIcon } from './brand'
import { t } from './i18n'

export type NotifyKind = 'turn-complete' | 'ask' | 'approval' | 'request'
export type NotificationPermission = 'granted' | 'denied' | 'unknown'

/**
 * Menu-bar tray + OS notifications (settings-notifications.rpml).
 *
 * Electron's Notification API maps to UserNotifications on macOS; permission
 * is requested the first time a notification would fire.
 */
export class NotificationCenter {
  private tray: Tray | null = null
  private permissionAsked = false
  private runningCount = 0
  private lastPermission: NotificationPermission = 'unknown'

  constructor(
    private getSettings: () => AppSettings,
    private onOpenConversation: (conversationId: string) => void,
    private onOpenSettings: () => void,
    private getMainWindow: () => BrowserWindow | null
  ) {}

  permissionStatus(): NotificationPermission {
    this.lastPermission = readNotificationPermission()
    return this.lastPermission
  }

  applySettings(): void {
    const settings = this.getSettings()
    let trayOk = false
    if (settings.trayEnabled) trayOk = this.ensureTray()
    else this.destroyTray()

    if (process.platform === 'darwin' && app.dock) {
      // Never hide the Dock unless the status item is actually alive — otherwise
      // the app vanishes with no way back (menu bar + Dock both empty).
      if (settings.hideDockIcon && settings.trayEnabled && trayOk) {
        app.dock.hide()
      } else {
        app.dock.show()
        // hide/show drops a runtime setIcon — re-apply after the tile is back.
        applyDockIcon()
      }
    }
  }

  setRunningCount(count: number): void {
    this.runningCount = Math.max(0, count)
    this.refreshTrayTitle()
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

  /** @returns true when a live Tray status item exists. */
  private ensureTray(): boolean {
    if (this.tray) {
      this.refreshTrayMenu()
      return true
    }
    const icon = trayIcon()
    if (icon.isEmpty()) {
      console.error('[tray] empty icon — refusing to create blank status item')
      return false
    }
    try {
      this.tray = new Tray(icon)
    } catch (err) {
      console.error('[tray] failed to create status item', err)
      this.tray = null
      return false
    }
    this.tray.setToolTip(APP_NAME)
    // macOS: left-click opens the app; menu stays on right-click / click+hold.
    this.tray.on('click', () => this.showMain())
    this.tray.on('right-click', () => this.tray?.popUpContextMenu())
    this.refreshTrayMenu()
    this.refreshTrayTitle()
    const size = icon.getSize()
    const scales =
      typeof (icon as NativeImage & { getScaleFactors?: () => number[] }).getScaleFactors ===
      'function'
        ? (icon as NativeImage & { getScaleFactors: () => number[] }).getScaleFactors()
        : []
    console.log(
      `[tray] status item ready path=${resolveTrayTemplatePath() ?? 'fallback'} ` +
        `${size.width}x${size.height} scales=[${scales.join(',')}] template=${icon.isTemplateImage()}`
    )
    return true
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private refreshTrayTitle(): void {
    if (!this.tray) return
    // Icon-only status item; show a count badge only while sessions are running.
    this.tray.setTitle(this.runningCount > 0 ? String(this.runningCount) : '')
  }

  private refreshTrayMenu(runningTitles: { id: string; title: string }[] = []): void {
    if (!this.tray) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (runningTitles.length === 0) {
      items.push({ label: APP_NAME, enabled: false })
    } else {
      items.push({
        label: t('tray.running', { count: runningTitles.length }),
        enabled: false
      })
      for (const row of runningTitles) {
        items.push({
          label: row.title,
          click: () => this.onOpenConversation(row.id)
        })
      }
    }
    items.push(
      { type: 'separator' },
      { label: t('common.settingsEllipsis'), click: () => this.onOpenSettings() },
      { label: t('common.quit'), click: () => app.quit() }
    )
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  /** Call when turn activity changes so the tray menu lists live sessions. */
  updateRunningSessions(sessions: { id: string; title: string }[]): void {
    this.setRunningCount(sessions.length)
    this.refreshTrayMenu(sessions)
  }

  private showMain(): void {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
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

/**
 * Brand tray mark: `trayTemplate.png` + `nina.v@example.com` (+ optional @3x).
 *
 * Never reuse the Dock app icon — scaling a 1024px colour asset into the menu
 * bar is what made the status item look huge and muddy. Prefer path-based
 * load so Electron/macOS pick the Retina neighbor by filename; then attach any
 * extra scale factors that `createFromPath` missed.
 */
function trayIcon(): NativeImage {
  const base = resolveTrayTemplatePath()
  if (base) {
    const image = nativeImage.createFromPath(base)
    if (!image.isEmpty()) {
      const dir = dirname(base)
      const have = new Set(
        typeof (image as NativeImage & { getScaleFactors?: () => number[] }).getScaleFactors ===
        'function'
          ? (image as NativeImage & { getScaleFactors: () => number[] }).getScaleFactors()
          : [1]
      )
      for (const scale of [2, 3] as const) {
        if (have.has(scale)) continue
        const path = join(dir, `trayTemplate@${scale}x.png`)
        if (!existsSync(path)) continue
        try {
          image.addRepresentation({
            scaleFactor: scale,
            dataURL: `data:image/png;base64,${readFileSync(path).toString('base64')}`
          })
        } catch (err) {
          console.warn(`[tray] failed to add @${scale}x representation`, err)
        }
      }
      if (process.platform === 'darwin') image.setTemplateImage(true)
      return image
    }
  }

  const empty = nativeImage.createEmpty()
  console.warn('[tray] missing build/trayTemplate.png — status item may be blank')
  return empty
}

function resolveTrayTemplatePath(): string | null {
  const file = 'trayTemplate.png'
  // Branded dev Electron reports `isPackaged` even when loading the repo, so
  // never trust that flag alone. Prefer repo `build/`, then bundled resources
  // (release installs put trays in extraResources).
  const candidates = [
    join(process.cwd(), 'build', file),
    join(__dirname, '../../build', file),
    join(__dirname, '../../../build', file),
    join(app.getAppPath(), 'build', file),
    join(app.getAppPath(), '../build', file),
    join(process.resourcesPath, file)
  ]
  const hit = candidates.find((path) => existsSync(path))
  if (!hit) {
    console.warn('[tray] template not found; tried:\n  ' + candidates.join('\n  '))
  }
  return hit ?? null
}
