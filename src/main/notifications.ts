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
import { APP_NAME, applyDockIcon, loadAppIcon } from './brand'
import { t } from './i18n'

/** One multi-res tray glyph for the process lifetime — avoid rebuild thrash. */
let cachedTrayIcon: NativeImage | null = null

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
    const scales = icon.getScaleFactors?.() ?? []
    console.log(
      `[tray] status item ready ${size.width}x${size.height}pt scales=[${scales.join(',')}] platform=${process.platform}`
    )
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
 * - macOS: multi-resolution template PNGs (1x/2x/3x, black + alpha).
 *   Loading only the 22px 1x file made Retina menu-bar icons look soft /
 *   “over-drawn” — @2x/@3x assets were packaged but never attached.
 * - Windows / Linux: colour app mark with 1x+2x reps for the notification area.
 */
function trayIcon(): NativeImage {
  if (cachedTrayIcon && !cachedTrayIcon.isEmpty()) return cachedTrayIcon

  const built = buildTrayIcon()
  if (!built.isEmpty()) cachedTrayIcon = built
  return built
}

function buildTrayIcon(): NativeImage {
  if (IS_MAC) {
    const multi = loadMacTrayTemplate()
    if (multi && !multi.isEmpty()) return multi
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

  const color = loadColorTrayIcon()
  if (color && !color.isEmpty()) return color

  console.warn('[tray] missing tray icon assets — status item may be blank')
  return nativeImage.createEmpty()
}

/**
 * Attach every available trayTemplate scale into one NSImage so the menu bar
 * picks the right bitmap instead of upscaling 22×22 into mush.
 */
function loadMacTrayTemplate(): NativeImage | null {
  const dir = resolveTrayTemplateDir()
  if (!dir) return null

  // Logical menu-bar size (points). Bitmaps: 22 / 44 / 66.
  const reps: Array<{ file: string; scale: number }> = [
    { file: 'trayTemplate.png', scale: 1 },
    { file: 'trayTemplate@2x.png', scale: 2 },
    { file: 'trayTemplate@3x.png', scale: 3 }
  ]

  const image = nativeImage.createEmpty()
  let added = 0
  for (const rep of reps) {
    const path = join(dir, rep.file)
    if (!existsSync(path)) continue
    try {
      // Prefer buffer + scaleFactor: createFromPath(1x) alone never finds @2x siblings.
      image.addRepresentation({
        scaleFactor: rep.scale,
        buffer: readFileSync(path)
      })
      added += 1
    } catch (err) {
      console.warn(`[tray] failed to add ${rep.file}`, err)
    }
  }

  if (added === 0) {
    // Last resort: single file (may be blurry on HiDPI).
    const fallbackPath = join(dir, 'trayTemplate.png')
    if (!existsSync(fallbackPath)) return null
    const single = nativeImage.createFromPath(fallbackPath)
    if (single.isEmpty()) return null
    single.setTemplateImage(true)
    return single
  }

  image.setTemplateImage(true)
  return image
}

/** Colour mark with 16pt + 32pt bitmaps so Win/Linux tray isn’t a soft 16px upscale. */
function loadColorTrayIcon(): NativeImage | null {
  const markPath = resolveTrayColorIconPath()
  const source = markPath
    ? nativeImage.createFromPath(markPath)
    : loadAppIcon('light')
  if (!source || source.isEmpty()) return null

  // Build multi-res from the large mark rather than a single 16px resize.
  const image = nativeImage.createEmpty()
  try {
    const px16 = source.resize({ width: 16, height: 16, quality: 'best' })
    const px32 = source.resize({ width: 32, height: 32, quality: 'best' })
    image.addRepresentation({
      scaleFactor: 1,
      width: 16,
      height: 16,
      buffer: px16.toPNG()
    })
    image.addRepresentation({
      scaleFactor: 2,
      width: 32,
      height: 32,
      buffer: px32.toPNG()
    })
    if (!image.isEmpty()) return image
  } catch {
    // fall through to simple resize
  }
  return source.resize({ width: 16, height: 16, quality: 'best' })
}

/** Directory that holds trayTemplate.png (and ideally @2x/@3x). */
function resolveTrayTemplateDir(): string | null {
  const file = 'trayTemplate.png'
  const candidates = [
    join(process.resourcesPath, file),
    join(process.cwd(), 'build', file),
    join(__dirname, '../../build', file),
    join(__dirname, '../../../build', file),
    join(app.getAppPath(), 'build', file),
    join(app.getAppPath(), '../build', file)
  ]
  const hit = candidates.find((path) => existsSync(path))
  return hit ? dirname(hit) : null
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
