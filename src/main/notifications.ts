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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME, applyDockIcon, loadAppIcon } from './brand'
import { t } from './i18n'

export type NotifyKind = 'turn-complete' | 'ask' | 'approval' | 'request'
export type NotificationPermission = 'granted' | 'denied' | 'unknown'

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

/**
 * OS notifications + system tray (settings-notifications.rpml).
 *
 * macOS: tray is optional (Dock is the primary re-summon path).
 * Windows: tray is always on — there is no Dock; close hides to tray.
 */
export class NotificationCenter {
  private tray: Tray | null = null
  private permissionAsked = false
  private runningCount = 0
  private runningSessions: { id: string; title: string }[] = []
  private lastPermission: NotificationPermission = 'unknown'

  constructor(
    private getSettings: () => AppSettings,
    private onOpenConversation: (conversationId: string) => void,
    private onOpenSettings: () => void,
    private onShowMain: () => void,
    _getMainWindow: () => BrowserWindow | null
  ) {}

  permissionStatus(): NotificationPermission {
    this.lastPermission = readNotificationPermission()
    return this.lastPermission
  }

  /** True while a live status / notification-area icon exists. */
  hasTray(): boolean {
    return this.tray !== null
  }

  applySettings(): void {
    const settings = this.getSettings()
    // Windows always keeps a tray icon so closing the window is reversible.
    const wantTray = IS_WIN || settings.trayEnabled
    let trayOk = false
    if (wantTray) trayOk = this.ensureTray()
    else this.destroyTray()

    if (IS_MAC && app.dock) {
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
    // Left-click opens the app; context menu on right-click (Windows + macOS).
    this.tray.on('click', () => this.onShowMain())
    this.tray.on('double-click', () => this.onShowMain())
    this.tray.on('right-click', () => this.tray?.popUpContextMenu())
    this.refreshTrayMenu()
    this.refreshTrayTitle()
    const size = icon.getSize()
    console.log(`[tray] status item ready ${size.width}x${size.height} platform=${process.platform}`)
    return true
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private refreshTrayTitle(): void {
    if (!this.tray) return
    // macOS menu bar can show a numeric title; Windows uses tooltip only.
    if (IS_MAC) {
      this.tray.setTitle(this.runningCount > 0 ? String(this.runningCount) : '')
    }
    this.tray.setToolTip(
      this.runningCount > 0 ? t('tray.running', { count: this.runningCount }) : APP_NAME
    )
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return
    const items: Electron.MenuItemConstructorOptions[] = []
    if (this.runningSessions.length === 0) {
      items.push({ label: APP_NAME, enabled: false })
    } else {
      items.push({
        label: t('tray.running', { count: this.runningSessions.length }),
        enabled: false
      })
      for (const row of this.runningSessions) {
        items.push({
          label: row.title,
          click: () => this.onOpenConversation(row.id)
        })
      }
    }
    items.push(
      { type: 'separator' },
      { label: t('common.open'), click: () => this.onShowMain() },
      { label: t('common.settingsEllipsis'), click: () => this.onOpenSettings() },
      { label: t('common.quit'), click: () => app.quit() }
    )
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  /** Call when turn activity changes so the tray menu lists live sessions. */
  updateRunningSessions(sessions: { id: string; title: string }[]): void {
    this.runningSessions = sessions
    this.setRunningCount(sessions.length)
    this.refreshTrayMenu()
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
 * Tray glyph:
 * - macOS: dedicated template PNGs (black + alpha) for the menu bar.
 * - Windows / Linux: colour app mark resized for the notification area.
 */
function trayIcon(): NativeImage {
  if (IS_MAC) {
    const path = resolveTrayTemplatePath()
    if (path) {
      const image = nativeImage.createFromPath(path)
      if (!image.isEmpty()) {
        image.setTemplateImage(true)
        return image
      }
    }
    try {
      const named = nativeImage.createFromNamedImage('NSActionTemplate')
      if (named && !named.isEmpty()) {
        named.setTemplateImage(true)
        return named
      }
    } catch {
      // fall through
    }
  }

  const markPath = resolveTrayColorIconPath()
  if (markPath) {
    const image = nativeImage.createFromPath(markPath)
    if (!image.isEmpty()) {
      // Notification area is typically 16 CSS px; @2x displays cleaner on HiDPI.
      return image.resize({ width: 16, height: 16, quality: 'best' })
    }
  }

  const fallback = loadAppIcon('light')
  if (fallback && !fallback.isEmpty()) {
    return fallback.resize({ width: 16, height: 16, quality: 'best' })
  }

  console.warn('[tray] missing tray icon assets — status item may be blank')
  return nativeImage.createEmpty()
}

function resolveTrayTemplatePath(): string | null {
  const file = 'trayTemplate.png'
  const candidates = [
    join(process.resourcesPath, file),
    join(process.cwd(), 'build', file),
    join(__dirname, '../../build', file),
    join(__dirname, '../../../build', file),
    join(app.getAppPath(), 'build', file),
    join(app.getAppPath(), '../build', file)
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

function resolveTrayColorIconPath(): string | null {
  const files = ['icon-mark.png', 'icon.png']
  const roots = [
    process.resourcesPath,
    join(process.cwd(), 'build'),
    join(__dirname, '../../build'),
    join(__dirname, '../../../build'),
    join(app.getAppPath(), 'build'),
    join(app.getAppPath(), '../build')
  ]
  for (const file of files) {
    for (const root of roots) {
      const path = join(root, file)
      if (existsSync(path)) return path
    }
  }
  return null
}
